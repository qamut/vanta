//! Dispositivos de áudio (Core Audio / MMDevice API).
//!
//! Mostra o dispositivo de saída padrão, o tipo (fone, headset, alto-falante), o barramento
//! quando o Windows informa (Bluetooth, USB, interno) e o volume — com controle real de
//! volume e mudo. Nível de bateria de fones **não** é lido: o Windows não oferece uma API
//! pública e uniforme para isso, então o estado diz que não está disponível.

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    /// "headphones" | "headset" | "speakers" | "display" | "spdif" | "line" | "other"
    pub form: String,
    /// "bluetooth" | "usb" | "internal" | "virtual" | "unknown"
    pub bus: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    pub available: bool,
    pub error: Option<String>,
    pub default_output: Option<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
    pub volume: Option<f32>,
    pub muted: Option<bool>,
    /// Sempre `false` hoje: deixado explícito para a interface não prometer bateria.
    pub battery_available: bool,
}

pub(crate) enum Msg {
    Changed,
    SetVolume(f32, Sender<AppResult<()>>),
    SetMute(bool, Sender<AppResult<()>>),
}

pub struct Audio {
    tx: Mutex<Sender<Msg>>,
    state: Arc<Mutex<AudioState>>,
}

pub fn form_from_code(code: u32) -> &'static str {
    match code {
        1 => "speakers",
        2 => "line",
        3 => "headphones",
        5 => "headset",
        8 => "spdif",
        9 => "display",
        _ => "other",
    }
}

pub fn bus_from_enumerator(enumerator: &str, instance_hint: &str) -> &'static str {
    let e = enumerator.to_ascii_uppercase();
    let h = instance_hint.to_ascii_uppercase();
    if e.contains("BTH") || h.contains("BTHENUM") || h.contains("BTHHFENUM") || h.contains("BTHLEDEVICE") {
        "bluetooth"
    } else if e.contains("USB") {
        "usb"
    } else if e.contains("HDAUDIO") || e.contains("INTELAUDIO") || e.contains("ACPI") || e.contains("PCI") {
        "internal"
    } else if e == "ROOT" {
        "virtual"
    } else {
        "unknown"
    }
}

pub fn start(app: &AppHandle) -> Audio {
    let (tx, rx) = mpsc::channel();
    let state = Arc::new(Mutex::new(AudioState::default()));
    let (app2, tx2, state2) = (app.clone(), tx.clone(), state.clone());
    std::thread::Builder::new()
        .name("vanta-audio".into())
        .spawn(move || {
            #[cfg(windows)]
            imp::run(app2, rx, tx2, state2);
            #[cfg(not(windows))]
            {
                drop(tx2);
                crate::audio_unix::run(app2, rx, state2);
            }
        })
        .expect("thread de áudio");
    Audio { tx: Mutex::new(tx), state }
}

#[tauri::command]
pub fn audio_state(audio: State<'_, Audio>) -> AudioState {
    audio.state.lock().map(|s| s.clone()).unwrap_or_default()
}

fn round_trip(audio: &Audio, make: impl FnOnce(Sender<AppResult<()>>) -> Msg) -> AppResult<()> {
    let (rtx, rrx) = mpsc::channel();
    audio
        .tx
        .lock()
        .map_err(|_| AppError::io("canal"))?
        .send(make(rtx))
        .map_err(|_| AppError::unavailable("serviço de áudio parado"))?;
    rrx.recv_timeout(Duration::from_secs(3)).unwrap_or_else(|_| Err(AppError::unavailable("sem resposta")))
}

#[tauri::command]
pub fn audio_set_volume(audio: State<'_, Audio>, level: f32) -> AppResult<()> {
    if !level.is_finite() || !(0.0..=1.0).contains(&level) {
        return Err(AppError::invalid("volume fora de 0..1"));
    }
    round_trip(&audio, |r| Msg::SetVolume(level, r))
}

#[tauri::command]
pub fn audio_set_mute(audio: State<'_, Audio>, muted: bool) -> AppResult<()> {
    round_trip(&audio, |r| Msg::SetMute(muted, r))
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::sync::mpsc::{Receiver, RecvTimeoutError};
    use windows::core::{implement, PCWSTR};
    use windows::Win32::Devices::FunctionDiscovery::{PKEY_Device_EnumeratorName, PKEY_Device_FriendlyName};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::Endpoints::{
        IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
    };
    use windows::Win32::Media::Audio::{
        eConsole, eRender, EDataFlow, ERole, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient,
        IMMNotificationClient_Impl, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
        DEVICE_STATE_ACTIVE, PKEY_AudioEndpoint_FormFactor,
    };
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc, PropVariantToUInt32};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    #[implement(IMMNotificationClient)]
    struct DeviceNotifier {
        tx: Sender<Msg>,
    }

    impl IMMNotificationClient_Impl for DeviceNotifier_Impl {
        fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> windows::core::Result<()> {
            let _ = self.tx.send(Msg::Changed);
            Ok(())
        }
        fn OnDeviceAdded(&self, _id: &PCWSTR) -> windows::core::Result<()> {
            let _ = self.tx.send(Msg::Changed);
            Ok(())
        }
        fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
            let _ = self.tx.send(Msg::Changed);
            Ok(())
        }
        fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _id: &PCWSTR) -> windows::core::Result<()> {
            if flow == eRender && role == eConsole {
                let _ = self.tx.send(Msg::Changed);
            }
            Ok(())
        }
        fn OnPropertyValueChanged(&self, _id: &PCWSTR, _key: &PROPERTYKEY) -> windows::core::Result<()> {
            Ok(())
        }
    }

    #[implement(IAudioEndpointVolumeCallback)]
    struct VolumeNotifier {
        tx: Sender<Msg>,
    }

    impl IAudioEndpointVolumeCallback_Impl for VolumeNotifier_Impl {
        fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
            let _ = self.tx.send(Msg::Changed);
            Ok(())
        }
    }

    unsafe fn prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
        let mut pv = store.GetValue(key).ok()?;
        let out = PropVariantToStringAlloc(&pv).ok().and_then(|p| {
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const _));
            s
        });
        let _ = PropVariantClear(&mut pv);
        out
    }

    unsafe fn prop_u32(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<u32> {
        let mut pv = store.GetValue(key).ok()?;
        let out = PropVariantToUInt32(&pv).ok();
        let _ = PropVariantClear(&mut pv);
        out
    }

    unsafe fn describe(device: &IMMDevice, default_id: &str) -> Option<AudioDevice> {
        let id_ptr = device.GetId().ok()?;
        let id = id_ptr.to_string().unwrap_or_default();
        CoTaskMemFree(Some(id_ptr.0 as *const _));
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let name = prop_string(&store, &PKEY_Device_FriendlyName).unwrap_or_else(|| "Saída de áudio".into());
        let form = form_from_code(prop_u32(&store, &PKEY_AudioEndpoint_FormFactor).unwrap_or(10)).to_string();
        let enumerator = prop_string(&store, &PKEY_Device_EnumeratorName).unwrap_or_default();
        let bus = bus_from_enumerator(&enumerator, &id).to_string();
        Some(AudioDevice { is_default: id == default_id, id, name, form, bus })
    }

    struct Ctx {
        enumerator: IMMDeviceEnumerator,
        volume: Option<(IAudioEndpointVolume, IAudioEndpointVolumeCallback)>,
        tx: Sender<Msg>,
    }

    impl Ctx {
        unsafe fn read(&mut self) -> AudioState {
            let default = self.enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok();
            let default_id = default
                .as_ref()
                .and_then(|d| d.GetId().ok())
                .map(|p| {
                    let s = p.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(p.0 as *const _));
                    s
                })
                .unwrap_or_default();

            let mut outputs = Vec::new();
            if let Ok(coll) = self.enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                let n = coll.GetCount().unwrap_or(0);
                for i in 0..n {
                    if let Ok(d) = coll.Item(i) {
                        if let Some(info) = describe(&d, &default_id) {
                            outputs.push(info);
                        }
                    }
                }
            }

            // Re-registra o callback de volume no dispositivo padrão atual.
            if let Some((vol, cb)) = self.volume.take() {
                let _ = vol.UnregisterControlChangeNotify(&cb);
            }
            let (mut volume, mut muted) = (None, None);
            if let Some(d) = &default {
                if let Ok(vol) = d.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                    volume = vol.GetMasterVolumeLevelScalar().ok();
                    muted = vol.GetMute().ok().map(|b| b.as_bool());
                    let cb: IAudioEndpointVolumeCallback = VolumeNotifier { tx: self.tx.clone() }.into();
                    if vol.RegisterControlChangeNotify(&cb).is_ok() {
                        self.volume = Some((vol, cb));
                    }
                }
            }
            AudioState {
                available: true,
                error: None,
                default_output: outputs.iter().find(|o| o.is_default).cloned(),
                outputs,
                volume,
                muted,
                battery_available: false,
            }
        }
    }

    pub fn run(app: AppHandle, rx: Receiver<Msg>, tx: Sender<Msg>, state: Arc<Mutex<AudioState>>) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let enumerator: IMMDeviceEnumerator = match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
            Ok(e) => e,
            Err(e) => {
                let s = AudioState { available: false, error: Some(e.message().to_string()), ..Default::default() };
                if let Ok(mut cur) = state.lock() {
                    *cur = s.clone();
                }
                let _ = app.emit("audio://state", s);
                log::warn!(target: "audio", "MMDeviceEnumerator indisponível: {e}");
                return;
            }
        };
        let notifier: IMMNotificationClient = DeviceNotifier { tx: tx.clone() }.into();
        if let Err(e) = unsafe { enumerator.RegisterEndpointNotificationCallback(&notifier) } {
            log::warn!(target: "audio", "sem notificações de dispositivo: {e}");
        }
        let mut ctx = Ctx { enumerator, volume: None, tx };
        let publish = |ctx: &mut Ctx| {
            let s = unsafe { ctx.read() };
            let changed = state.lock().map(|cur| *cur != s).unwrap_or(false);
            if changed {
                if let Ok(mut cur) = state.lock() {
                    *cur = s.clone();
                }
                let _ = app.emit("audio://state", s);
            }
        };
        publish(&mut ctx);
        loop {
            match rx.recv_timeout(Duration::from_secs(120)) {
                Ok(Msg::Changed) | Err(RecvTimeoutError::Timeout) => {
                    // Agrupa rajadas (o Windows dispara vários eventos ao trocar de fone).
                    while let Ok(m) = rx.recv_timeout(Duration::from_millis(150)) {
                        handle_sync(&mut ctx, m);
                    }
                    publish(&mut ctx);
                }
                Ok(m) => {
                    handle_sync(&mut ctx, m);
                    publish(&mut ctx);
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    fn handle_sync(ctx: &mut Ctx, m: Msg) {
        let vol = ctx.volume.as_ref().map(|(v, _)| v.clone());
        match m {
            Msg::Changed => {}
            Msg::SetVolume(level, reply) => {
                let r = match vol {
                    Some(v) => unsafe { v.SetMasterVolumeLevelScalar(level, std::ptr::null()) }.map_err(AppError::from),
                    None => Err(AppError::unavailable("nenhum dispositivo de saída ativo")),
                };
                let _ = reply.send(r);
            }
            Msg::SetMute(m, reply) => {
                let r = match vol {
                    Some(v) => unsafe { v.SetMute(m, std::ptr::null()) }.map_err(AppError::from),
                    None => Err(AppError::unavailable("nenhum dispositivo de saída ativo")),
                };
                let _ = reply.send(r);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_factor_codes() {
        assert_eq!(form_from_code(3), "headphones");
        assert_eq!(form_from_code(5), "headset");
        assert_eq!(form_from_code(1), "speakers");
        assert_eq!(form_from_code(10), "other");
    }

    #[test]
    fn bus_detection_is_conservative() {
        assert_eq!(bus_from_enumerator("BTHENUM", ""), "bluetooth");
        assert_eq!(bus_from_enumerator("USB", ""), "usb");
        assert_eq!(bus_from_enumerator("HDAUDIO", ""), "internal");
        assert_eq!(bus_from_enumerator("", "{0.0.0.00000000}.{abc}"), "unknown");
    }
}

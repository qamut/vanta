//! Áudio no Linux (PulseAudio/PipeWire pelo `pactl`) e no macOS (AppleScript + system_profiler).
//!
//! Sem eventos: o volume é relido a cada 2 s e o dispositivo de saída a cada 15 s (no macOS o
//! `system_profiler` leva quase um segundo). Os interpretadores de texto são puros e testados
//! em qualquer sistema; só a chamada aos programas depende do sistema.

use std::process::Command;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::audio::{AudioDevice, AudioState, Msg};
use crate::error::AppError;

// ---------------------------------------------------------------- Linux: pactl

#[derive(Debug, Default, PartialEq)]
pub struct Sink {
    pub name: String,
    pub description: String,
    pub muted: bool,
    pub volume: Option<f32>,
    pub bus: String,
    pub form: String,
}

/// `LC_ALL=C pactl list sinks`: um bloco por "Sink #N", com propriedades indentadas.
pub fn parse_sinks(text: &str) -> Vec<Sink> {
    let mut out: Vec<Sink> = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("Sink #") {
            out.push(Sink::default());
            continue;
        }
        let Some(s) = out.last_mut() else { continue };
        if let Some(v) = t.strip_prefix("Name: ") {
            s.name = v.to_string();
        } else if let Some(v) = t.strip_prefix("Description: ") {
            s.description = v.to_string();
        } else if let Some(v) = t.strip_prefix("Mute: ") {
            s.muted = v == "yes";
        } else if let Some(v) = t.strip_prefix("Volume: ") {
            s.volume = v.split('/').nth(1).and_then(|p| p.trim().trim_end_matches('%').parse::<f32>().ok()).map(|p| (p / 100.0).clamp(0.0, 1.0));
        } else if let Some((k, v)) = t.split_once(" = ") {
            let v = v.trim_matches('"');
            match k {
                "device.bus" => s.bus = v.to_string(),
                "device.api" if v == "bluez5" || v == "bluez" => s.bus = "bluetooth".into(),
                "device.form_factor" => s.form = v.to_string(),
                _ => {}
            }
        }
    }
    out
}

fn bus_of(bus: &str) -> &'static str {
    match bus {
        "bluetooth" => "bluetooth",
        "usb" => "usb",
        "pci" | "isa" | "platform" => "internal",
        "" => "unknown",
        _ => "unknown",
    }
}

fn form_of(form: &str, name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    match form {
        "headphone" | "headphones" => "headphones",
        "headset" | "hands-free" => "headset",
        "speaker" | "internal" => "speakers",
        _ if n.contains("hdmi") || n.contains("displayport") => "display",
        _ if n.contains("iec958") || n.contains("spdif") => "spdif",
        _ => "other",
    }
}

fn pactl(args: &[&str]) -> Result<String, String> {
    let out = Command::new("pactl").args(args).env("LC_ALL", "C").output().map_err(|e| format!("pactl indisponível: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn linux_state() -> AudioState {
    let default = match pactl(&["get-default-sink"]) {
        Ok(d) => d.trim().to_string(),
        Err(e) => return AudioState { available: false, error: Some(e), ..Default::default() },
    };
    let sinks = match pactl(&["list", "sinks"]) {
        Ok(t) => parse_sinks(&t),
        Err(e) => return AudioState { available: false, error: Some(e), ..Default::default() },
    };
    let outputs: Vec<AudioDevice> = sinks
        .iter()
        .map(|s| AudioDevice {
            id: s.name.clone(),
            name: if s.description.is_empty() { s.name.clone() } else { s.description.clone() },
            form: form_of(&s.form, &s.name).into(),
            bus: bus_of(&s.bus).into(),
            is_default: s.name == default,
        })
        .collect();
    let cur = sinks.iter().find(|s| s.name == default);
    AudioState {
        available: true,
        error: None,
        default_output: outputs.iter().find(|d| d.is_default).cloned(),
        outputs,
        volume: cur.and_then(|s| s.volume),
        muted: cur.map(|s| s.muted),
        battery_available: false,
    }
}

fn linux_set_volume(level: f32) -> Result<(), String> {
    pactl(&["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", (level * 100.0).round() as i32)]).map(|_| ())
}

fn linux_set_mute(muted: bool) -> Result<(), String> {
    pactl(&["set-sink-mute", "@DEFAULT_SINK@", if muted { "1" } else { "0" }]).map(|_| ())
}

// ---------------------------------------------------------------- macOS: AppleScript + system_profiler

/// `get volume settings` → "output volume:50, input volume:75, alert volume:100, output muted:false".
pub fn parse_volume_settings(text: &str) -> (Option<f32>, Option<bool>) {
    let mut volume = None;
    let mut muted = None;
    for part in text.trim().split(", ") {
        match part.split_once(':') {
            Some(("output volume", v)) => volume = v.trim().parse::<f32>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0)),
            Some(("output muted", v)) => muted = Some(v.trim() == "true"),
            _ => {}
        }
    }
    (volume, muted)
}

/// `system_profiler SPAudioDataType -json`: os dispositivos de saída e qual é o padrão.
pub fn parse_profiler(json: &str) -> Vec<AudioDevice> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    let mut out = Vec::new();
    for group in v["SPAudioDataType"].as_array().into_iter().flatten() {
        for item in group["_items"].as_array().into_iter().flatten() {
            if item.get("coreaudio_device_output").is_none() {
                continue;
            }
            let name = item["_name"].as_str().unwrap_or("Saída de áudio").to_string();
            let transport = item["coreaudio_device_transport"].as_str().unwrap_or_default();
            let bus = if transport.contains("bluetooth") {
                "bluetooth"
            } else if transport.contains("usb") {
                "usb"
            } else if transport.contains("builtin") {
                "internal"
            } else if transport.contains("virtual") {
                "virtual"
            } else {
                "unknown"
            };
            let lower = name.to_ascii_lowercase();
            let form = if lower.contains("airpods") || lower.contains("headphone") || lower.contains("fone") {
                "headphones"
            } else if transport.contains("builtin") || lower.contains("speaker") || lower.contains("alto-falante") {
                "speakers"
            } else if transport.contains("hdmi") || transport.contains("displayport") {
                "display"
            } else {
                "other"
            };
            out.push(AudioDevice {
                id: name.clone(),
                name,
                form: form.into(),
                bus: bus.into(),
                is_default: item["coreaudio_default_audio_output_device"].as_str() == Some("spaudio_yes"),
            });
        }
    }
    out
}

fn osascript(src: &str) -> Result<String, String> {
    let out = Command::new("osascript").args(["-e", src]).output().map_err(|e| format!("osascript indisponível: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn mac_devices() -> Vec<AudioDevice> {
    Command::new("system_profiler")
        .args(["SPAudioDataType", "-json"])
        .output()
        .ok()
        .map(|o| parse_profiler(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

fn mac_state(devices: &[AudioDevice]) -> AudioState {
    match osascript("get volume settings") {
        Ok(t) => {
            let (volume, muted) = parse_volume_settings(&t);
            AudioState {
                available: true,
                error: None,
                default_output: devices.iter().find(|d| d.is_default).cloned(),
                outputs: devices.to_vec(),
                volume,
                muted,
                battery_available: false,
            }
        }
        Err(e) => AudioState { available: false, error: Some(e), ..Default::default() },
    }
}

// ---------------------------------------------------------------- laço

pub fn run(app: AppHandle, rx: Receiver<Msg>, state: Arc<Mutex<AudioState>>) {
    let mac = cfg!(target_os = "macos");
    let mut devices: Vec<AudioDevice> = Vec::new();
    let mut devices_at: Option<Instant> = None;
    loop {
        if mac && devices_at.map(|t| t.elapsed() > Duration::from_secs(15)).unwrap_or(true) {
            devices = mac_devices();
            devices_at = Some(Instant::now());
        }
        let s = if mac { mac_state(&devices) } else { linux_state() };
        let changed = state.lock().map(|cur| *cur != s).unwrap_or(false);
        if changed {
            if let Ok(mut cur) = state.lock() {
                *cur = s.clone();
            }
            let _ = app.emit("audio://state", s);
        }
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Msg::SetVolume(level, reply)) => {
                let r = if mac { osascript(&format!("set volume output volume {}", (level * 100.0).round() as i32)).map(|_| ()) } else { linux_set_volume(level) };
                let _ = reply.send(r.map_err(AppError::unavailable));
            }
            Ok(Msg::SetMute(muted, reply)) => {
                let r = if mac { osascript(&format!("set volume output muted {muted}")).map(|_| ()) } else { linux_set_mute(muted) };
                let _ = reply.send(r.map_err(AppError::unavailable));
            }
            Ok(Msg::Changed) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SINKS: &str = "Sink #47\n\tState: RUNNING\n\tName: alsa_output.pci-0000_00_1f.3.analog-stereo\n\tDescription: Built-in Audio Analog Stereo\n\tMute: no\n\tVolume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB\n\tProperties:\n\t\tdevice.bus = \"pci\"\n\t\tdevice.form_factor = \"internal\"\nSink #52\n\tName: bluez_output.AA_BB.1\n\tDescription: WH-1000XM4\n\tMute: yes\n\tVolume: front-left: 45875 /  70% / -9.29 dB\n\tProperties:\n\t\tdevice.api = \"bluez5\"\n\t\tdevice.form_factor = \"headset\"\n";

    #[test]
    fn le_os_dispositivos_do_pactl() {
        let s = parse_sinks(SINKS);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].description, "Built-in Audio Analog Stereo");
        assert_eq!(s[0].volume, Some(0.5));
        assert!(!s[0].muted);
        assert_eq!((bus_of(&s[1].bus), form_of(&s[1].form, &s[1].name)), ("bluetooth", "headset"));
        assert!(s[1].muted);
    }

    #[test]
    fn le_o_volume_do_macos() {
        assert_eq!(parse_volume_settings("output volume:50, input volume:75, alert volume:100, output muted:false\n"), (Some(0.5), Some(false)));
        assert_eq!(parse_volume_settings("output volume:missing value, input volume:missing value, alert volume:100, output muted:true"), (None, Some(true)));
    }

    #[test]
    fn le_os_dispositivos_do_system_profiler() {
        let json = r#"{"SPAudioDataType":[{"_name":"coreaudio_device","_items":[
            {"_name":"AirPods Pro","coreaudio_device_output":2,"coreaudio_device_transport":"coreaudio_device_type_bluetooth","coreaudio_default_audio_output_device":"spaudio_yes"},
            {"_name":"MacBook Pro Speakers","coreaudio_device_output":2,"coreaudio_device_transport":"coreaudio_device_type_builtin"},
            {"_name":"MacBook Pro Microphone","coreaudio_device_input":1,"coreaudio_device_transport":"coreaudio_device_type_builtin"}]}]}"#;
        let d = parse_profiler(json);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].form.as_str(), d[0].bus.as_str(), d[0].is_default), ("headphones", "bluetooth", true));
        assert_eq!(d[1].form, "speakers");
    }
}

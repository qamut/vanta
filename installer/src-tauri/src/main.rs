// Instalador do VANTA: interface própria por cima do instalador NSIS oficial do app.
// O NSIS (embutido aqui) continua responsável por arquivos, desinstalador e menu Iniciar;
// este programa conduz a experiência e aplica as opções escolhidas.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

static PAYLOAD: &[u8] = include_bytes!(env!("VANTA_PAYLOAD_PATH"));
const VERSION: &str = env!("CARGO_PKG_VERSION");
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTA";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupInfo {
    version: String,
    installed_version: Option<String>,
    install_dir: String,
    payload_ok: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Options {
    autostart: bool,
    desktop: bool,
}

#[derive(Serialize, Clone)]
struct Phase<'a> {
    phase: &'a str,
}

fn install_dir() -> PathBuf {
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("VANTA")
}

fn exe_path() -> PathBuf {
    install_dir().join("vanta.exe")
}

#[cfg(windows)]
mod sys {
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Registry::*;
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT};

    pub fn reg_get(sub: &str, name: &str) -> Option<String> {
        unsafe {
            let mut size = 0u32;
            let (sk, nm) = (HSTRING::from(sub), HSTRING::from(name));
            if RegGetValueW(HKEY_CURRENT_USER, &sk, &nm, RRF_RT_REG_SZ, None, None, Some(&mut size)) != ERROR_SUCCESS || size == 0 {
                return None;
            }
            let mut buf = vec![0u16; (size as usize).div_ceil(2)];
            if RegGetValueW(HKEY_CURRENT_USER, &sk, &nm, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut size)) != ERROR_SUCCESS {
                return None;
            }
            let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..end]))
        }
    }

    pub fn set_autostart(exe: &str, on: bool) -> bool {
        unsafe {
            let mut key = HKEY::default();
            if RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(super::RUN_KEY), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None)
                != ERROR_SUCCESS
            {
                return false;
            }
            let name = HSTRING::from("VANTA");
            let ok = if on {
                let value = format!("\"{exe}\"");
                let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
                let bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
                RegSetValueExW(key, &name, None, REG_SZ, Some(bytes)) == ERROR_SUCCESS
            } else {
                let r = RegDeleteValueW(key, &name);
                r == ERROR_SUCCESS || r.0 == 2
            };
            let _ = RegCloseKey(key);
            ok
        }
    }

    pub fn desktop_shortcut(exe: &str, dir: &str) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let desktop = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).map_err(|e| e.to_string())?;
            let folder = desktop.to_string().map_err(|e| e.to_string())?;
            CoTaskMemFree(Some(desktop.0 as *const _));
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
            link.SetPath(&HSTRING::from(exe)).map_err(|e| e.to_string())?;
            link.SetWorkingDirectory(&HSTRING::from(dir)).map_err(|e| e.to_string())?;
            link.SetDescription(&HSTRING::from("VANTA — Dynamic Island para Windows")).map_err(|e| e.to_string())?;
            link.SetIconLocation(&HSTRING::from(exe), 0).map_err(|e| e.to_string())?;
            let file: IPersistFile = link.cast().map_err(|e| e.to_string())?;
            let path = format!("{folder}\\VANTA.lnk");
            file.Save(&HSTRING::from(path), true).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
fn setup_info() -> SetupInfo {
    #[cfg(windows)]
    let installed_version = if exe_path().exists() { sys::reg_get(UNINSTALL_KEY, "DisplayVersion").or(Some(String::new())) } else { None };
    #[cfg(not(windows))]
    let installed_version = None;
    SetupInfo {
        version: VERSION.into(),
        installed_version,
        install_dir: install_dir().to_string_lossy().to_string(),
        payload_ok: PAYLOAD.len() > 1024 && PAYLOAD.starts_with(b"MZ"),
    }
}

fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn run_install(emit: &dyn Fn(&'static str), opts: &Options) -> Result<(), String> {
    if !(PAYLOAD.len() > 1024 && PAYLOAD.starts_with(b"MZ")) {
        return Err("O pacote do VANTA não está embutido neste instalador.".into());
    }
    emit("prepare");
    let tmp = std::env::temp_dir().join(format!("vanta-payload-{}.exe", std::process::id()));
    std::fs::write(&tmp, PAYLOAD).map_err(|e| format!("Não foi possível preparar os arquivos: {e}"))?;
    // Uma instância aberta seria substituída em uso: encerra antes.
    let _ = hidden(std::process::Command::new("taskkill").args(["/F", "/IM", "vanta.exe"])).status();
    std::thread::sleep(Duration::from_millis(400));

    emit("install");
    let status = hidden(std::process::Command::new(&tmp).arg("/S")).status().map_err(|e| format!("Falha ao iniciar a instalação: {e}"));
    let _ = std::fs::remove_file(&tmp);
    let status = status?;
    if !status.success() {
        return Err(format!("A instalação terminou com o código {}.", status.code().unwrap_or(-1)));
    }
    if !exe_path().exists() {
        return Err("A instalação não deixou o VANTA no lugar esperado.".into());
    }

    emit("configure");
    #[cfg(windows)]
    {
        let exe = exe_path().to_string_lossy().to_string();
        let dir = install_dir().to_string_lossy().to_string();
        if !sys::set_autostart(&exe, opts.autostart) {
            return Err("Não foi possível ajustar a inicialização com o Windows.".into());
        }
        if opts.desktop {
            sys::desktop_shortcut(&exe, &dir).map_err(|e| format!("Atalho na área de trabalho: {e}"))?;
        }
    }
    #[cfg(not(windows))]
    let _ = opts;
    emit("done");
    Ok(())
}

#[tauri::command]
async fn install(app: AppHandle, options: Options) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |p: &'static str| {
            let _ = handle.emit("setup://phase", Phase { phase: p });
        };
        run_install(&emit, &options)
    })
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch() -> Result<(), String> {
    std::process::Command::new(exe_path())
        .current_dir(install_dir())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn main() {
    // Modo silencioso (implantação e testes): `VANTA-Setup.exe --silent [--no-autostart] [--no-desktop]`.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--silent") {
        let opts = Options {
            autostart: !args.iter().any(|a| a == "--no-autostart"),
            desktop: !args.iter().any(|a| a == "--no-desktop"),
        };
        let code = match run_install(&|p| eprintln!("fase: {p}"), &opts) {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("erro: {e}");
                1
            }
        };
        std::process::exit(code);
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![setup_info, install, launch])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o instalador");
}

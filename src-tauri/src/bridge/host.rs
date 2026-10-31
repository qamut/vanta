//! Modo "host de Native Messaging" do próprio executável.
//!
//! O navegador inicia `VANTA.exe chrome-extension://<id>/` (Chrome/Edge/Brave) ou
//! `VANTA.exe <manifesto> media-bridge@vanta.app` (Firefox) com stdin/stdout ligados à
//! extensão. Neste modo nada de interface é criado: o processo só retransmite mensagens
//! entre o stdin/stdout e o pipe local do VANTA que já está em execução, e termina quando
//! qualquer um dos lados fecha.
//!
//! O pipe é aberto em modo *overlapped* (Tokio). Com um handle síncrono partilhado entre a
//! thread que lê e a que escreve, o Windows serializa as operações no mesmo objeto de
//! arquivo: a escrita ficaria presa atrás da leitura pendente e o fechamento nunca voltaria.

use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::sync::mpsc;

use super::pipe_name;
use super::proto::{self, CHROMIUM_EXTENSION_ID, FIREFOX_EXTENSION_ID};

/// Decide, pelos argumentos, se o processo foi iniciado por um navegador.
pub fn detect(args: &[String]) -> Option<String> {
    let chromium = format!("chrome-extension://{CHROMIUM_EXTENSION_ID}/");
    if args.iter().any(|a| a == &chromium) {
        return Some("chromium".into());
    }
    if args.iter().any(|a| a == FIREFOX_EXTENSION_ID) {
        return Some("firefox".into());
    }
    None
}

fn write_stdout(json: &[u8]) -> bool {
    let mut out = std::io::stdout().lock();
    proto::write_frame(&mut out, json).is_ok()
}

pub fn run(family: &str) -> i32 {
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(_) => return 1,
    };
    rt.block_on(relay(family))
}

async fn relay(family: &str) -> i32 {
    let name = pipe_name();
    let mut client = None;
    for _ in 0..10 {
        match ClientOptions::new().open(&name) {
            Ok(c) => {
                client = Some(c);
                break;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(300)).await,
        }
    }
    let Some(client) = client else {
        // O VANTA não está aberto: avisa a extensão e sai. Ela tenta de novo mais tarde.
        write_stdout(br#"{"type":"status","state":"app-offline"}"#);
        return 0;
    };
    let (read_half, mut write_half) = tokio::io::split(client);

    // stdin é bloqueante: fica numa thread própria e entrega quadros por canal.
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        // Só JSON válido e de tamanho limitado atravessa.
        while let Ok(Some(frame)) = proto::read_frame(&mut stdin) {
            if serde_json::from_slice::<serde_json::Value>(&frame).is_ok() && tx.send(frame).is_err() {
                break;
            }
        }
        // stdin fechado = o navegador encerrou a porta.
        std::process::exit(0);
    });

    let hello = format!("{{\"type\":\"_family\",\"family\":\"{family}\"}}\n");
    if write_half.write_all(hello.as_bytes()).await.is_err() {
        return 1;
    }

    let to_app = async move {
        while let Some(frame) = rx.recv().await {
            if write_half.write_all(&frame).await.is_err() || write_half.write_all(b"\n").await.is_err() {
                break;
            }
        }
    };
    let to_browser = async move {
        let mut lines = BufReader::new(read_half).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.len() > proto::MAX_FRAME || !write_stdout(line.as_bytes()) {
                break;
            }
        }
    };
    // Qualquer lado que termine encerra o host; o navegador reconecta quando precisar.
    tokio::select! {
        _ = to_app => {},
        _ = to_browser => {},
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_our_extensions() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            detect(&args(&["vanta.exe", &format!("chrome-extension://{CHROMIUM_EXTENSION_ID}/"), "--parent-window=0"])),
            Some("chromium".into())
        );
        assert_eq!(detect(&args(&["vanta.exe", "C:\\x\\host.json", FIREFOX_EXTENSION_ID])), Some("firefox".into()));
        assert_eq!(detect(&args(&["vanta.exe", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"])), None);
        assert_eq!(detect(&args(&["vanta.exe"])), None);
    }
}

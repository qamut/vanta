fn main() {
    // O instalador NSIS gerado pelo `tauri build` do app é embutido neste executável.
    // Sem VANTA_PAYLOAD (ex.: `cargo check`), embute um arquivo vazio e o instalador avisa.
    println!("cargo:rerun-if-env-changed=VANTA_PAYLOAD");
    let payload = match std::env::var("VANTA_PAYLOAD") {
        Ok(p) if std::path::Path::new(&p).is_file() => {
            println!("cargo:rerun-if-changed={p}");
            p
        }
        _ => {
            let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("empty-payload.bin");
            std::fs::write(&out, b"").expect("payload vazio");
            out.to_string_lossy().to_string()
        }
    };
    println!("cargo:rustc-env=VANTA_PAYLOAD_PATH={payload}");
    tauri_build::build()
}

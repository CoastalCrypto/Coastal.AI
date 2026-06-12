fn main() {
    // Expose the build target triple to the binary so the sidecar supervisor
    // can locate the matching `coastal-core-<triple>` runtime on any OS
    // (bundle-sidecar.mjs names it with the same triple).
    if let Ok(triple) = std::env::var("TARGET") {
        println!("cargo:rustc-env=COASTAL_TARGET_TRIPLE={triple}");
    }
    tauri_build::build()
}

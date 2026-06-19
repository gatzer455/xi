use std::env;
use std::fs;
use std::path::PathBuf;

/// Hook de build: prepara lo que el sidecar de pi necesita para correr
/// en `tauri dev`.
///
/// Tauri 2 busca los sidecars (configurados en `externalBin` de
/// `tauri.conf.json`) en el directorio `target/<profile>/`. En
/// producción los copia al bundle automáticamente; en dev no. Además,
/// pi (compilado con `bun --compile`) busca sus recursos — la carpeta
/// `theme/` con `dark.json` y `light.json` — al lado del binario en
/// runtime. Como en dev el binario vive en `target/debug/`, hay que
/// poner el sidecar y sus recursos ahí.
///
/// El sidecar principal (`pi`) es **obligatorio**: sin él la app no
/// puede spawnear el motor. Si falta, tauri_build falla primero con
/// el error "resource path X doesn't exist". El mensaje accionable
/// está en `SETUP.md` ("Primer build" → `./scripts/build-pi.sh`).
///
/// El sidecar secundario (`pi-sessions`) es **opcional**: solo se usa
/// para la feature de gestión de sesiones (Etapa 4). Si falta, se
/// loguea un warning y la app compila, pero esa feature no funcionará.
fn main() {
    tauri_build::build();
    let paths = resolve_paths();
    copy_sidecar(&paths);
    copy_pi_sessions(&paths);
    copy_theme_dir(&paths);
    copy_pi_package_json(&paths);
}

struct BuildPaths {
    manifest_dir: PathBuf,
    target_profile_dir: PathBuf,
    sidecar_name: String,
    pi_sessions_name: String,
}

fn resolve_paths() -> BuildPaths {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_triple = env::var("TARGET").unwrap_or_else(|_| default_target_triple());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let target_dir = env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_dir.join("target"));
    BuildPaths {
        manifest_dir,
        target_profile_dir: target_dir.join(&profile),
        sidecar_name: format!("pi-{}", target_triple),
        pi_sessions_name: format!("pi-sessions-{}", target_triple),
    }
}

fn copy_sidecar(paths: &BuildPaths) {
    let source = paths.manifest_dir.join(&paths.sidecar_name);
    let dest = paths.target_profile_dir.join(&paths.sidecar_name);

    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed=build.rs");

    if !source.exists() {
        // En la práctica, este caso casi nunca se ejecuta: tauri_build
        // ya falla antes con un error claro cuando el binario no está
        // en `manifest_dir`. Pero si por algún motivo se llegara aquí
        // (ej. el binario existe pero no es válido), dejamos un
        // warning útil. El error accionable está documentado en
        // `SETUP.md` ("Primer build").
        println!(
            "cargo:warning=Sidecar source not found at {}. If this is a fresh clone, run ./scripts/build-pi.sh first (see SETUP.md).",
            source.display()
        );
        return;
    }

    fs::create_dir_all(&paths.target_profile_dir).expect("Failed to create target profile dir");
    copy_if_newer(&source, &dest);
}

/// Copia el binario `pi-sessions` (nuestro script CLI para gestión de
/// sesiones) a `target/<profile>/`. Es el segundo sidecar de xi: Tauri
/// también lo invoca con `shell.sidecar("pi-sessions")`, así que tiene
/// que estar adyacente al binario de pi en el mismo directorio.
///
/// El source de TypeScript vive en `backend/scripts/pi-sessions.ts` y
/// se compila con `./scripts/build-pi-sessions.sh`. Si el binario
/// compilado no existe, se loguea un warning (igual que con `pi`) y el
/// fallo se verá en runtime.
fn copy_pi_sessions(paths: &BuildPaths) {
    let source = paths.manifest_dir.join(&paths.pi_sessions_name);
    let dest = paths.target_profile_dir.join("pi-sessions");

    println!("cargo:rerun-if-changed={}", source.display());
    // Rebuild si cambia el source de TS (para que el dev recuerde
    // re-compilar el binario con bun).
    println!(
        "cargo:rerun-if-changed={}",
        paths.manifest_dir.join("scripts/pi-sessions.ts").display()
    );

    if !source.exists() {
        println!(
            "cargo:warning=pi-sessions binary not found at {}. Run ./scripts/build-pi-sessions.sh first.",
            source.display()
        );
        return;
    }

    fs::create_dir_all(&paths.target_profile_dir).expect("Failed to create target profile dir");
    copy_if_newer(&source, &dest);
}

fn copy_theme_dir(paths: &BuildPaths) {
    // pi busca `theme/dark.json` y `theme/light.json` al lado del
    // binario en runtime (`getThemesDir()` = `dirname(exe) + "/theme"`).
    // En dev el binario vive en `target/debug/`, así que copiamos la
    // carpeta `theme/` desde la fuente del backend a target/debug.
    let source_dir = paths.manifest_dir.join("theme");
    let dest_dir = paths.target_profile_dir.join("theme");

    if !source_dir.exists() {
        // No es un error fatal: pi puede correr con `--no-themes`, o
        // este proyecto podría no usar los temas builtin.
        println!(
            "cargo:warning=Theme dir not found at {}. pi will fail unless started with --no-themes.",
            source_dir.display()
        );
        return;
    }

    println!("cargo:rerun-if-changed={}", source_dir.display());
    fs::create_dir_all(&dest_dir).expect("Failed to create theme dest dir");

    let entries = match fs::read_dir(&source_dir) {
        Ok(e) => e,
        Err(err) => {
            println!("cargo:warning=Failed to read {}: {}", source_dir.display(), err);
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name() else { continue };
        let dest = dest_dir.join(name);
        copy_if_newer(&path, &dest);
    }
}

/// Copia el `package.json` de pi al `target/<profile>/` para que el
/// sidecar pueda encontrarlo en dev mode. En release, Tauri lo copia
/// como resource del bundle (ver `tauri.conf.json` -> `bundle.resources`).
///
/// Por qué: pi (compilado con `bun --compile`) lee su `package.json`
/// desde `dirname(exe)` o desde el env var `PI_PACKAGE_DIR`. Sin este
/// archivo, retorna "0.0.0" como versión y los endpoints que dependen
/// del package name fallan.
///
/// El source vive en `backend/binaries/package.json` (generado por
/// `scripts/build-pi.sh` con la versión real del package de npm).
fn copy_pi_package_json(paths: &BuildPaths) {
    let source = paths.manifest_dir.join("binaries").join("package.json");
    let dest = paths.target_profile_dir.join("package.json");

    println!("cargo:rerun-if-changed={}", source.display());

    if !source.exists() {
        // No es un error fatal: pi puede correr con `PI_PACKAGE_DIR`
        // apuntando a otro lado, o `--version` retorna "0.0.0" sin
        // romperse. Pero la versión de pi en settings será "desconocida".
        println!(
            "cargo:warning=pi package.json not found at {}. Run ./scripts/build-pi.sh to regenerate it.",
            source.display()
        );
        return;
    }

    fs::create_dir_all(&paths.target_profile_dir).expect("Failed to create target profile dir");
    copy_if_newer(&source, &dest);
}

fn copy_if_newer(source: &PathBuf, dest: &PathBuf) {
    let should_copy = match (fs::metadata(source), fs::metadata(dest)) {
        (Ok(s), Ok(d)) => s.modified().ok() > d.modified().ok(),
        (Ok(_), Err(_)) => true,
        _ => false,
    };
    if should_copy {
        fs::copy(source, dest).expect("Failed to copy");
    }
}

fn default_target_triple() -> String {
    std::process::Command::new("rustc")
        .arg("-")
        .arg("--print")
        .arg("host-tuple")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "x86_64-unknown-linux-gnu".to_string())
}

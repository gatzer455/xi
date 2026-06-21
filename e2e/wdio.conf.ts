/**
 * wdio.conf.ts — Configuración de WebdriverIO para E2E tests de xi.
 *
 * Sigue el ejemplo oficial de Tauri:
 * https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/
 *
 * tauri-driver se maneja manualmente en beforeSession/afterSession.
 * No usa @wdio/tauri-service para evitar conflictos de puertos.
 */

import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Path al binario de Tauri (debug build)
const TAURI_APP = path.join(ROOT, 'backend', 'target', 'debug', 'xi-backend');

// Proceso de tauri-driver — se inicia en beforeSession, se cierra en afterSession
let tauriDriver: ReturnType<typeof spawn> | null = null;
let exit = false;

export const config: WebdriverIO.Config = {
  hostname: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: TAURI_APP,
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // Compilar el app en modo debug antes de empezar
  onPrepare: () => {
    console.log('\n🔨 Compilando xi en modo debug...\n');
    spawnSync('cargo', ['build'], {
      cwd: path.join(ROOT, 'backend'),
      stdio: 'inherit',
    });
  },

  // Iniciar tauri-driver antes de cada sesión
  beforeSession: () => {
    tauriDriver = spawn(
      path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver'),
      [],
      { stdio: [null, process.stdout, process.stderr] }
    );

    tauriDriver.on('error', (error) => {
      console.error('tauri-driver error:', error);
      process.exit(1);
    });

    tauriDriver.on('exit', (code) => {
      if (!exit) {
        console.error('tauri-driver exited with code:', code);
        process.exit(1);
      }
    });
  },

  // Cerrar tauri-driver después de cada sesión
  afterSession: () => {
    closeTauriDriver();
  },
};

function closeTauriDriver() {
  exit = true;
  tauriDriver?.kill();
}

// Asegurar que tauri-driver se cierra al salir del proceso
function onShutdown(fn: () => void) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
}

onShutdown(() => {
  closeTauriDriver();
});

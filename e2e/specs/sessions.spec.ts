/**
 * sessions.spec.ts — E2E de la página de sesiones.
 *
 * Flujo:
 *   1. Welcome carga → setear workingDir via window.__XI_APP_STATE
 *      (solo disponible en dev mode) → auto-navega a #/sessions
 *   2. Verificar elementos de la página de sesiones
 *   3. Volver a welcome
 *
 * NOTA: el sidecar pi-sessions puede no estar compilado
 * (se necesita bun + npm). Si falla, la página muestra un error
 * en vez de la lista de sesiones. Igual se verifica que la UI
 * renderiza correctamente.
 */

describe('Página de sesiones', () => {
  before(async () => {
    // Esperar a que la welcome cargue completamente.
    const subtitle = await $('.welcome-subtitle');
    await subtitle.waitForExist({ timeout: 10000 });

    // Setear workingDir para disparar la navegación automática a
    // sesiones. WelcomePage tiene una suscripción que navega a
    // #/sessions cuando workingDir cambia (solo si es distinto al
    // initialDir, que es null al arrancar).
    //
    // __XI_APP_STATE se expone en window solo en dev mode
    // (import.meta.env.DEV en main.ts). En producción no existe.
    await browser.execute(() => {
      const xi = (window as Record<string, unknown>).__XI_APP_STATE as {
        workingDir: { value: string | null };
      };
      if (xi) {
        xi.workingDir.value = '/tmp';
      }
    });

    // Esperar a que la página de sesiones se monte.
    const page = await $('.sessions-page');
    await page.waitForExist({ timeout: 10000 });
  });

  it('debería mostrar el título "Sesiones"', async () => {
    const title = await browser.execute(() => {
      const h1 = document.querySelector('.sessions-header h1');
      return h1?.textContent ?? '';
    });
    expect(title).toBe('Sesiones');
  });

  it('debería tener el botón "Nueva conversación"', async () => {
    const btn = await $('.sessions-new');
    const text = await btn.getText();
    expect(text).toContain('Nueva conversación');
  });

  it('debería tener el botón "Volver"', async () => {
    const back = await $('.sessions-back');
    const text = await back.getText();
    expect(text).toContain('Volver');
  });

  it('debería mostrar la lista de sesiones', async () => {
    const list = await $('.sessions-list-inner');
    const exists = await list.isExisting();
    expect(exists).toBe(true);
  });

  it('debería mostrar un estado en la lista (vacía, error o sesiones)', async () => {
    // Después de loadSessions(), la UI muestra uno de tres estados:
    //   - sesiones (session-card) si hay sesiones
    //   - mensaje vacío (sessions-empty) si no hay sesiones
    //   - error (sessions-error) si falló pi-sessions
    // Esperamos a que cualquiera de estos aparezca.
    const estadoVisible = await browser.waitUntil(async () => {
      const empty = await $('.sessions-empty');
      const errorBanner = await $('.sessions-error');
      const cards = await $$('.session-card');
      return (
        (await empty.isExisting()) ||
        (await errorBanner.isExisting()) ||
        cards.length > 0
      );
    }, { timeout: 15000, timeoutMsg: 'No apareció ningún estado de sesiones' });
    expect(estadoVisible).toBe(true);
  });

  it('debería tener indicador de polling en el footer', async () => {
    const status = await $('.sessions-status');
    const text = await status.getText();
    expect(text).toContain('30s');
  });

  it('debería tener botón de refrescar en el footer', async () => {
    const refresh = await $('.sessions-footer button');
    const text = await refresh.getText();
    expect(text).toContain('Refrescar');
  });

  it('debería poder volver a la welcome', async () => {
    await browser.execute(() => {
      const back = document.querySelector('.sessions-back');
      if (back instanceof HTMLElement) back.click();
    });
    await browser.pause(500);
    const welcome = await $('.welcome-page, .welcome-subtitle');
    const exists = await welcome.isExisting();
    expect(exists).toBe(true);
  });
});

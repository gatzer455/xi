/**
 * settings.spec.ts — E2E de la página de configuración.
 *
 * Navega desde welcome hasta settings usando el botón "Ir a
 * Configuración", y verifica que las secciones estén presentes.
 */

describe('Página de configuración', () => {
  before(async () => {
    // Esperar a que la welcome cargue completamente.
    const subtitle = await $('.welcome-subtitle');
    await subtitle.waitForExist({ timeout: 10000 });

    // Navegar a settings desde la welcome. El botón "Ir a
    // Configuración" vive dentro de un banner que puede estar
    // oculto (visibility:hidden cuando hay providers configurados).
    // Primero esperamos a que el botón exista en DOM (en CI lento,
    // isExisting() con wdio+tauri-driver puede fallar por race
    // condition del WebKitWebDriver). Luego hacemos click via
    // executeScript para bypassar el check de interactabilidad.
    const btn = await $('.welcome-auth-banner-btn');
    await btn.waitForExist({ timeout: 10000 });
    await browser.execute(() => {
      const el = document.querySelector('.welcome-auth-banner-btn');
      if (el instanceof HTMLElement) el.click();
    });
    // Esperar a que la página de settings se monte.
    const settingsTitle = await $('.settings-title');
    await settingsTitle.waitForExist({ timeout: 10000 });
  });

  it('debería mostrar el título "Configuración"', async () => {
    const title = await $('.settings-title');
    const text = await title.getText();
    expect(text).toBe('Configuración');
  });

  it('debería tener el botón "Volver"', async () => {
    const back = await $('.settings-back');
    const text = await back.getText();
    expect(text).toContain('Volver');
  });

  it('debería mostrar la sección Apariencia', async () => {
    const titles = await browser.execute(() =>
      Array.from(document.querySelectorAll('.settings-section-title'))
        .map((el) => el.textContent ?? ''),
    );
    expect(titles).toContain('Apariencia');
  });

  it('debería mostrar la sección Acerca de', async () => {
    const titles = await browser.execute(() =>
      Array.from(document.querySelectorAll('.settings-section-title'))
        .map((el) => el.textContent ?? ''),
    );
    expect(titles).toContain('Acerca de');
  });

  it('debería mostrar la versión de xi en Acerca de', async () => {
    const texts = await browser.execute(() =>
      Array.from(document.querySelectorAll('.settings-value'))
        .map((el) => el.textContent ?? ''),
    );
    const versionText = texts.find((t) => t.includes('xi v'));
    expect(versionText).toBeTruthy();
  });

  it('debería poder volver a la welcome', async () => {
    await browser.execute(() => {
      const back = document.querySelector('.settings-back');
      if (back instanceof HTMLElement) back.click();
    });
    const welcome = await $('.welcome-page, .welcome-subtitle');
    await welcome.waitForExist({ timeout: 5000 });
    expect(await welcome.isExisting()).toBe(true);
  });
});

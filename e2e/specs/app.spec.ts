/**
 * app.spec.ts — Tests E2E básicos de xi.
 *
 * Verifica que la app arranca y muestra los elementos fundamentales.
 * Usa el expect global de WebdriverIO (estilo Jest, no chai).
 */

describe('xi App', () => {
  it('debería abrir la ventana con contenido', async () => {
    const body = await $('body');
    await body.waitUntil(async () => {
      const text = await body.getText();
      return text.length > 0;
    }, { timeout: 10000 });
    const text = await body.getText();
    expect(text).not.toBe('');
  });

  it('debería mostrar la página de bienvenida', async () => {
    // La bienvenida tiene un título o elemento con clase welcome
    const title = await $('h1, h2, [class*="welcome"], [class*="title"]');
    const exists = await title.isExisting();
    expect(exists).toBe(true);
  });

  it('debería tener un elemento interactuable', async () => {
    const interactive = await $('button, a, input');
    const exists = await interactive.isExisting();
    expect(exists).toBe(true);
  });
});

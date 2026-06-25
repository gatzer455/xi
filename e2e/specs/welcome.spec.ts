/**
 * welcome.spec.ts — E2E de la pantalla de bienvenida.
 *
 * Verifica que la welcome muestra los elementos esperados al arrancar:
 * subtítulo explicativo, CTA "Seleccioná una carpeta", sección de
 * recientes, link de ayuda y botón de ir a configuración.
 */

describe('Pantalla de bienvenida', () => {
  it('debería mostrar el subtítulo que explica qué es xi', async () => {
    const subtitle = await $('.welcome-subtitle');
    const text = await subtitle.getText();
    expect(text).toContain('asistente de inteligencia artificial');
  });

  it('debería tener el botón CTA para seleccionar carpeta', async () => {
    const cta = await $('.welcome-cta');
    const exists = await cta.isExisting();
    expect(exists).toBe(true);
  });

  it('debería mostrar la sección de proyectos recientes', async () => {
    const recents = await $('.welcome-recents');
    const exists = await recents.isExisting();
    expect(exists).toBe(true);
  });

  it('debería tener el link de ayuda', async () => {
    const link = await $('.welcome-help-link');
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toContain('http');
  });

  it('debería tener botón para ir a configuración', async () => {
    const btn = await $('.welcome-auth-banner-btn');
    await btn.waitForExist({ timeout: 10000 });
    expect(await btn.isExisting()).toBe(true);
  });
});

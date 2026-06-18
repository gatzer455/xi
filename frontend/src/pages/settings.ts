/**
 * settings.ts — Página de configuración (Capa 1 + Capa 3)
 */

import { appState } from '../lib/state.ts';
import { navigate } from '../lib/nav.ts';

export function SettingsPage(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'settings-page';

  // ═══ Back button ═══
  const back = document.createElement('button');
  back.textContent = '← Volver al chat';
  back.style.cssText = 'color: var(--color-text-muted); font-size: var(--text-sm); margin-bottom: var(--space-6);';
  back.addEventListener('click', () => navigate('chat'));
  page.append(back);

  // ═══ Title ═══
  const title = document.createElement('h1');
  title.className = 'settings-title';
  title.textContent = 'Configuración';
  page.append(title);

  // ═══ Model section ═══
  const modelSection = document.createElement('div');
  modelSection.className = 'settings-section';

  const modelTitle = document.createElement('h2');
  modelTitle.className = 'settings-section-title';
  modelTitle.textContent = 'Modelo';
  modelSection.append(modelTitle);

  const modelRow = document.createElement('div');
  modelRow.className = 'settings-row';

  const modelLabel = document.createElement('span');
  modelLabel.className = 'settings-label';
  modelLabel.textContent = 'Modelo actual';
  modelRow.append(modelLabel);

  const modelValue = document.createElement('span');
  modelValue.className = 'settings-value';
  modelValue.textContent = 'sin modelo';
  appState.currentModel.subscribe(model => {
    modelValue.textContent = model ? `${model.provider}/${model.id}` : 'sin modelo';
  });
  modelRow.append(modelValue);

  modelSection.append(modelRow);
  page.append(modelSection);

  // ═══ Thinking section ═══
  const thinkingSection = document.createElement('div');
  thinkingSection.className = 'settings-section';

  const thinkingTitle = document.createElement('h2');
  thinkingTitle.className = 'settings-section-title';
  thinkingTitle.textContent = 'Razonamiento';
  thinkingSection.append(thinkingTitle);

  const thinkingRow = document.createElement('div');
  thinkingRow.className = 'settings-row';

  const thinkingLabel = document.createElement('span');
  thinkingLabel.className = 'settings-label';
  thinkingLabel.textContent = 'Nivel de thinking';
  thinkingRow.append(thinkingLabel);

  const thinkingValue = document.createElement('span');
  thinkingValue.className = 'settings-value';
  thinkingValue.textContent = appState.thinkingLevel.value;
  appState.thinkingLevel.subscribe(level => {
    thinkingValue.textContent = level;
  });
  thinkingRow.append(thinkingValue);

  thinkingSection.append(thinkingRow);
  page.append(thinkingSection);

  // ═══ Session section ═══
  const sessionSection = document.createElement('div');
  sessionSection.className = 'settings-section';

  const sessionTitle = document.createElement('h2');
  sessionTitle.className = 'settings-section-title';
  sessionTitle.textContent = 'Sesión';
  sessionSection.append(sessionTitle);

  const sessionRow = document.createElement('div');
  sessionRow.className = 'settings-row';

  const sessionLabel = document.createElement('span');
  sessionLabel.className = 'settings-label';
  sessionLabel.textContent = 'Sesión actual';
  sessionRow.append(sessionLabel);

  const sessionValue = document.createElement('span');
  sessionValue.className = 'settings-value';
  sessionValue.textContent = 'ninguna';
  appState.session.subscribe(session => {
    sessionValue.textContent = session ? session.id.slice(0, 8) + '...' : 'ninguna';
  });
  sessionRow.append(sessionValue);

  sessionSection.append(sessionRow);
  page.append(sessionSection);

  // ═══ About section ═══
  const aboutSection = document.createElement('div');
  aboutSection.className = 'settings-section';

  const aboutTitle = document.createElement('h2');
  aboutTitle.className = 'settings-section-title';
  aboutTitle.textContent = 'Acerca de';
  aboutSection.append(aboutTitle);

  const aboutRow = document.createElement('div');
  aboutRow.className = 'settings-row';

  const aboutLabel = document.createElement('span');
  aboutLabel.className = 'settings-label';
  aboutLabel.textContent = 'Versión';
  aboutRow.append(aboutLabel);

  const aboutValue = document.createElement('span');
  aboutValue.className = 'settings-value';
  aboutValue.textContent = '0.1.0';
  aboutRow.append(aboutValue);

  aboutSection.append(aboutRow);
  page.append(aboutSection);

  return page;
}

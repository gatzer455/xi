/**
 * Header.tsx — Top bar del app shell.
 */
import { createSignal, onCleanup, onMount } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { icon } from 'xi-ui/lib/icons.ts';
import { pickAndOpenProject } from '../lib/workdir.ts';

/** Componente que renderiza un icono Phosphor como SVG inline. */
function IconEl(props: { name: string; size?: number }) {
  let ref: HTMLSpanElement | undefined;
  onMount(() => { if (ref) ref.append(icon(props.name, { size: props.size ?? 16 })); });
  return <span ref={ref} />;
}

export function Header() {
  return (
    <div class="top-bar">
      <img class="top-bar-logo" src="/xi-icon.svg" alt="xi" width={28} height={28}
           style={{ cursor: 'pointer' }} title="Inicio"
           onClick={() => navigate('welcome')} />
      <ProjectCard />
    </div>
  );
}

function ProjectCard() {
  const [dir, setDir] = createSignal(appState.workingDir.value);
  onCleanup(appState.workingDir.subscribe(setDir));

  return (
    <button class="top-bar-project"
            title={dir() ?? 'Haz click para seleccionar una carpeta de trabajo'}
            onClick={() => pickAndOpenProject().catch(console.error)}>
      {dir() ? dir()!.split('/').pop()! : 'Seleccionar proyecto'}
    </button>
  );
}


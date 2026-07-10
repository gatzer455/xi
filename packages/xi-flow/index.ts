import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAsk } from "./ask";
import { registerApprove } from "./approve";
import { registerNestedContext } from "./nested-context";

/**
 * xi-flow
 *
 * Extensión unificada de herramientas de flujo de trabajo para pi.
 * Combina tres capacidades bajo un mismo namespace:
 *
 * 1. ask     — tool para que el LLM haga preguntas de clarificación al usuario
 * 2. approve — gate de seguridad que pide confirmación antes de comandos/escrituras peligrosas
 * 3. nested-context — carga on-demand de AGENTS.md/CLAUDE.md anidados
 *    (cuando el LLM lee un archivo en un directorio, se inyecta el contexto de ese directorio)
 */
export default function xiFlow(pi: ExtensionAPI) {
	registerAsk(pi);
	registerApprove(pi);
	registerNestedContext(pi);
}

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter } from '@codemirror/view';

export const setBreakpoints = StateEffect.define();
export const setPausedLine = StateEffect.define();

/** Lineas (1-based) que tienen breakpoint. */
export const breakpointField = StateField.define({
  create: () => new Set(),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setBreakpoints)) return new Set(e.value);
    }
    return value;
  },
});

/** Linea (1-based) donde el programa esta pausado, o null. */
export const pausedLineField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setPausedLine)) return e.value;
    }
    return value;
  },
});

const pausedLineDecoration = Decoration.line({ class: 'cm-paused-line' });

const pausedLineHighlight = EditorView.decorations.compute([pausedLineField], (state) => {
  const line = state.field(pausedLineField);
  if (!line || line > state.doc.lines) return Decoration.none;
  const lineObj = state.doc.line(line);
  return Decoration.set([pausedLineDecoration.range(lineObj.from)]);
});

// Devolvemos un marcador para TODAS las lineas (no solo las que tienen
// breakpoint): CodeMirror solo crea el elemento clickeable de la canaleta
// donde hay marcador, asi que sin esto solo se podria clickear encima de
// un breakpoint ya puesto. El punto rojo se muestra por CSS segun la clase.
class BreakpointMarker extends GutterMarker {
  constructor(active) {
    super();
    this.active = active;
  }
  eq(other) {
    return other.active === this.active;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = this.active ? 'cm-breakpoint-dot on' : 'cm-breakpoint-dot off';
    return el;
  }
}
const activeMarker = new BreakpointMarker(true);
const inactiveMarker = new BreakpointMarker(false);

/**
 * Canaleta clickeable a la izquierda de los numeros de linea, como en
 * VS Code: un click pone o saca un breakpoint. `onToggle(line, active)`
 * avisa para que el llamador lo sincronice con el debugger.
 */
export function breakpointGutter(onToggle) {
  return [
    breakpointField,
    pausedLineField,
    pausedLineHighlight,
    gutter({
      class: 'cm-breakpoint-gutter',
      lineMarker: (view, line) => {
        const lineNo = view.state.doc.lineAt(line.from).number;
        return view.state.field(breakpointField).has(lineNo) ? activeMarker : inactiveMarker;
      },
      lineMarkerChange: (update) =>
        update.startState.field(breakpointField) !== update.state.field(breakpointField),
      // El spacer solo reserva el ancho de la canaleta (va oculto), asi que
      // usa el marcador inactivo para no contar como un breakpoint real.
      initialSpacer: () => inactiveMarker,
      domEventHandlers: {
        mousedown(view, line) {
          const lineNo = view.state.doc.lineAt(line.from).number;
          const current = view.state.field(breakpointField);
          const next = new Set(current);
          const willBeActive = !next.has(lineNo);
          if (willBeActive) next.add(lineNo);
          else next.delete(lineNo);
          view.dispatch({ effects: setBreakpoints.of(next) });
          onToggle?.(lineNo, willBeActive);
          return true;
        },
      },
    }),
  ];
}

export function applyBreakpoints(view, lines) {
  if (!view) return;
  view.dispatch({ effects: setBreakpoints.of(new Set(lines)) });
}

export function applyPausedLine(view, line) {
  if (!view) return;
  view.dispatch({ effects: setPausedLine.of(line) });
  if (line && line <= view.state.doc.lines) {
    const pos = view.state.doc.line(line).from;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  }
}

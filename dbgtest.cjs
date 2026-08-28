const WebSocket = require('ws');
const code = `#include <iostream>
int suma(int a, int b) {
    int r = a + b;
    return r;
}
int main() {
    int n;
    std::cout << "Ingrese n: ";
    std::cin >> n;
    int total = suma(n, 100);
    std::cout << "total=" << total << std::endl;
    return 0;
}`;
const ws = new WebSocket('ws://localhost:3000/debug-ws');
let prog = '';
const steps = [];
ws.on('open', () => ws.send(JSON.stringify({ type:'start', code, fileName:'main.cpp', breakpoints:[9,10], cols:80, rows:24 })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'data') { prog += m.data; return; }
  if (m.type === 'compile-error') { console.log('COMPILE ERROR:', m.output); process.exit(1); }
  if (m.type === 'status') console.log('[status]', m.status, m.breakpoints ? 'bps='+JSON.stringify(m.breakpoints) : '');
  if (m.type === 'paused') {
    steps.push(m);
    console.log(`[PAUSA] linea ${m.line} en ${m.func}() reason=${m.reason}`);
    console.log('        vars:', m.variables.map(v=>`${v.name}=${v.value}`).join(', '));
    console.log('        stack:', m.frames.map(f=>`${f.func}:${f.line}`).join(' <- '));
    if (steps.length === 1) {
      console.log('  >> escribo 7 en la terminal del programa');
      ws.send(JSON.stringify({ type:'input', data:'7\r' }));
      setTimeout(()=>ws.send(JSON.stringify({type:'continue'})), 500);
    } else if (steps.length === 2) {
      console.log('  >> step (entrar a suma)');
      ws.send(JSON.stringify({ type:'step' }));
    } else if (steps.length === 3) {
      console.log('  >> evaluar expresion a*b');
      ws.send(JSON.stringify({ type:'evaluate', expression:'a * b' }));
    } else if (steps.length === 4) {
      ws.send(JSON.stringify({ type:'finish' }));
    } else {
      ws.send(JSON.stringify({ type:'continue' }));
    }
  }
  if (m.type === 'evaluated') { console.log('[EVAL]', m.expression, '=>', m.value ?? m.error); ws.send(JSON.stringify({type:'next'})); }
  if (m.type === 'exit') {
    console.log('[EXIT] code=', m.code, m.reason||'');
    console.log('SALIDA DEL PROGRAMA:', JSON.stringify(prog.replace(/&"warning[^"]*"\r\n/,'')));
    process.exit(0);
  }
});
setTimeout(()=>{ console.log('TIMEOUT'); process.exit(1); }, 30000);

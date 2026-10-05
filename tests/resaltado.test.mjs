/**
 * La capa de resaltado: de los términos de la consulta a posiciones sobre el
 * texto original. Lo que se mide acá son las tres decisiones del docstring de
 * `resaltado.js` — tildes en las dos direcciones, sólo principio de palabra, y
 * palabra entera — más el mapeo de offsets, que es donde está el error fácil.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { posicionesDeTerminos } = await import('../lib/docusaurus-theme/resaltado.js');

/** Aplica las posiciones, para leer el resultado como lo vería una persona. */
const marcar = (texto, terminos) => {
  let salida = '';
  let cursor = 0;
  for (const [inicio, largo] of posicionesDeTerminos(texto, terminos)) {
    salida += texto.slice(cursor, inicio) + '[' + texto.slice(inicio, inicio + largo) + ']';
    cursor = inicio + largo;
  }
  return salida + texto.slice(cursor);
};

describe('resaltado — las tildes no cuentan, en las dos direcciones', () => {
  it('la consulta sin tilde marca la palabra con tilde', () => {
    assert.equal(marcar('Costo de mercadería vendida', ['mercaderia']), 'Costo de [mercadería] vendida');
  });

  it('la consulta con tilde marca la palabra sin tilde', () => {
    assert.equal(marcar('Costo de mercaderia vendida', ['mercadería']), 'Costo de [mercaderia] vendida');
  });

  // El caso que hace fallar la implementación ingenua: NFD descompone `é` en
  // dos caracteres, así que normalizar y buscar sin mapa de vuelta devuelve
  // offsets corridos — y se corren justo en los textos con tilde.
  it('los offsets no se corren cuando hay tildes ANTES del match', () => {
    assert.equal(marcar('Conciliación y también facturación', ['facturacion']),
      'Conciliación y también [facturación]');
  });

  it('las mayúsculas tampoco cuentan', () => {
    assert.equal(marcar('Notas de Crédito', ['credito']), 'Notas de [Crédito]');
  });
});

describe('resaltado — sólo al principio de palabra', () => {
  // La regresión de v0.12.1: mark.js con `accuracy: 'partially'` marcaba
  // subcadenas, así que `cuenta` se resaltaba dentro de «descuenta».
  it('NO marca en el medio de una palabra', () => {
    assert.equal(marcar('El sistema descuenta el saldo', ['cuenta']), 'El sistema descuenta el saldo');
  });

  it('sí marca después de un signo, que no es parte de la palabra', () => {
    assert.equal(marcar('saldo (cuenta corriente)', ['cuenta']), 'saldo ([cuenta] corriente)');
  });
});

describe('resaltado — la palabra entera, no sólo el prefijo', () => {
  it('el prefijo marca la palabra completa', () => {
    assert.equal(marcar('Pasar a facturación electrónica', ['factur']),
      'Pasar a [facturación] electrónica');
  });

  it('el singular marca el plural', () => {
    assert.equal(marcar('Registrar un cobro de cliente', ['cobro', 'cliente']),
      'Registrar un [cobro] de [cliente]');
  });
});

describe('resaltado — varios términos y rangos que se pisan', () => {
  it('marca todas las apariciones de un término', () => {
    assert.equal(marcar('factura y factura', ['factura']), '[factura] y [factura]');
  });

  it('dos términos que caen en la misma palabra se unen en un rango', () => {
    // `factura` y `facturacion` matchean la misma palabra: si no se unieran,
    // el render emitiría un `<mark>` adentro de otro.
    const pos = posicionesDeTerminos('la facturación', ['factura', 'facturacion']);
    assert.equal(pos.length, 1);
    assert.equal(marcar('la facturación', ['factura', 'facturacion']), 'la [facturación]');
  });

  it('devuelve los rangos ordenados por posición, no por término', () => {
    const pos = posicionesDeTerminos('cobro y factura', ['factura', 'cobro']);
    assert.deepEqual(pos.map(([i]) => i), [0, 8]);
  });
});

describe('resaltado — lo que no rompe', () => {
  it('sin términos, sin texto o sin match devuelve vacío', () => {
    assert.deepEqual(posicionesDeTerminos('factura', []), []);
    assert.deepEqual(posicionesDeTerminos('', ['factura']), []);
    assert.deepEqual(posicionesDeTerminos('factura', ['kubernetes']), []);
    assert.deepEqual(posicionesDeTerminos(undefined, ['x']), []);
  });

  it('un término que es sólo puntuación no marca todo el texto', () => {
    assert.deepEqual(posicionesDeTerminos('factura', ['-', '  ', '¿?']), []);
  });

  // Un emoji ocupa dos unidades de código: recorrer por índice lo parte y el
  // mapa queda apuntando a la mitad de un carácter.
  it('un emoji antes del match no corre los offsets', () => {
    assert.equal(marcar('🎉 la factura', ['factura']), '🎉 la [factura]');
  });

  it('el texto se devuelve intacto al reconstruirlo', () => {
    const texto = 'Conciliación bancaria: el extracto del banco 🎉 y la facturación';
    assert.equal(marcar(texto, ['banco', 'facturacion']).replace(/[[\]]/g, ''), texto);
  });
});

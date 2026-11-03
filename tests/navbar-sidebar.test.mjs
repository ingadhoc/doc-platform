/**
 * The `docSidebar` navbar item of a section that is empty in one value of the
 * axis. `node --test tests/navbar-sidebar.test.mjs`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sidebarConDestino } from '../lib/docusaurus-theme/NavbarItem/sidebar.mjs';

const version = (name, sidebars) => ({ name, sidebars });
const conLink = { link: { path: '/19/guias', label: 'Guías' } };
const vacia = {};

describe('sidebarConDestino', () => {
  it('draws the item when the active version has pages in the section', () => {
    assert.equal(sidebarConDestino([version('current', { guias: conLink })], 'guias'), true);
  });

  it('hides it when the section is empty in the active version', () => {
    const versiones = [version('18', { guias: vacia }), version('current', { guias: conLink })];
    assert.equal(sidebarConDestino(versiones, 'guias'), false);
  });

  it('looks no further than the first version that declares the sidebar, like Docusaurus', () => {
    const versiones = [version('18', { manual: conLink }), version('current', { guias: conLink })];
    assert.equal(sidebarConDestino(versiones, 'guias'), true);
  });

  it('leaves a sidebar no version declares to Docusaurus, which reports the config error', () => {
    assert.equal(sidebarConDestino([version('current', { manual: conLink })], 'guias'), true);
    assert.equal(sidebarConDestino([], 'guias'), true);
  });

  it('tolerates a version without sidebars', () => {
    assert.equal(sidebarConDestino([version('18', undefined), version('current', { guias: vacia })], 'guias'), false);
  });
});

// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond Cloud
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const Trie = require('../../util/trie');

function arrayCombine(existing, newValue) {
    if (existing === undefined)
        existing = [];
    existing.unshift(newValue);
    return existing;
}

function testBasic() {
    const trie = new Trie(arrayCombine);

    trie.insert('abc', 1);

    assert.deepStrictEqual(trie.search('abc'), [1]);

    assert.deepStrictEqual(trie.search('abcd'), undefined);
    assert.deepStrictEqual(trie.search('ab'), undefined);
    assert.deepStrictEqual(trie.search('abd'), undefined);

    trie.insert('abc', 2);

    assert.deepStrictEqual(trie.search('abc'), [2, 1]);

    trie.insert('abc', 3);

    assert.deepStrictEqual(trie.search('abc'), [3, 2, 1]);

    assert.deepStrictEqual(trie.search('abcd'), undefined);
    assert.deepStrictEqual(trie.search('ab'), undefined);
    assert.deepStrictEqual(trie.search('abd'), undefined);

    trie.insert('abcd', 4);
    trie.insert('ab', 5);
    trie.insert('abd', 6);

    assert.deepStrictEqual(trie.search('abc'), [3, 2, 1]);
    assert.deepStrictEqual(trie.search('abcd'), [4]);
    assert.deepStrictEqual(trie.search('ab'), [5]);
    assert.deepStrictEqual(trie.search('abd'), [6]);
    assert.deepStrictEqual(trie.search('b'), undefined);
}

function wild(str) {
    const arr = [];
    for (let ch of str) {
        if (ch === '*')
            arr.push(Trie.WILDCARD);
        else
            arr.push(ch);
    }
    return arr;
}

function testWildcard() {
    const trie = new Trie(arrayCombine);

    trie.insert(wild('a*c'), 2);
    trie.insert(wild('*bc'), 3);

    assert.deepStrictEqual(trie.search('abc'), [2]);
    assert.deepStrictEqual(trie.search('adc'), [2]);
    assert.deepStrictEqual(trie.search('cbc'), [3]);
    assert.deepStrictEqual(trie.search('abd'), undefined);
    assert.deepStrictEqual(trie.search('aabc'), undefined);

    trie.insert('abc', 1);
    assert.deepStrictEqual(trie.search('abc'), [1]);
}

async function main() {
    testBasic();
    testWildcard();
}
module.exports = main;
if (!module.parent)
    main();

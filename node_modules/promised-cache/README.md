[![Build Status](https://travis-ci.org/tirithen/promised-cache.svg?branch=master)](https://travis-ci.org/tirithen/promised-cache)

# promised-cache

A cache meant for Node.js that stores in memory and to disk with a timeout. Each method returns a promise. Keys can be any type string/number/array/object as their hashes will be used internally.

## Install

    $ npm install promised-cache --save

## Example use

    const Cache = require('promised-cache');

    const cache = new Cache('cahename', 3600 * 1000);

    cache.set('a key', {some: {data: 'to store'}});

    cache.get('a key').then((cachedData) => {
      console.log(cachedData); // Prints {some: {data: 'to store'}}
    });

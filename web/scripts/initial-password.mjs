// Prints one random initial password for ONE new doctor account, generated on
// this computer (nothing is sent or stored). Give it to the doctor over a
// different channel than their email address (e.g. in person or by phone);
// the app forces them to replace it at first sign-in.
//
//   cd web && npm run admin:initial-password
import { randomInt } from 'node:crypto';

// No look-alike characters (0/O, 1/l/I).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const groups = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''));
console.log(groups.join('-')); // 20 random characters, about 116 bits.

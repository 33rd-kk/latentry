// Loaded with `node --import` by serve.mjs, so requests are stamped from the
// very first one (see lib/security/peer-stamp.mjs).

import { installPeerStamp } from '../lib/security/peer-stamp.mjs'

installPeerStamp()

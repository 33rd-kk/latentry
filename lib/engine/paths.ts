// Where the engine's runtime lives. Everything Latentry downloads to run it
// (uv, Python, the virtual environment, logs) goes under one folder in the
// app, so removing that folder undoes it all.
//
//   LATENTRY_RUNTIME_DIR   default: <app>/.runtime
//   models                 default: <app>/models (or the engine's models folder setting)

import path from 'node:path'

const exe = process.platform === 'win32' ? '.exe' : ''

export function runtimeDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.LATENTRY_RUNTIME_DIR?.trim() || '.runtime')
}

export function enginePaths() {
  const root = runtimeDir()
  const venv = path.join(root, 'venv')
  return {
    root,
    uv: path.join(root, 'uv', `uv${exe}`),
    venv,
    python: process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python'),
    // uv keeps its own Python and package cache here too, not in the user's home.
    uvCache: path.join(root, 'cache'),
    uvPython: path.join(root, 'python'),
    state: path.join(root, 'install.json'),
    logs: path.join(root, 'logs'),
    engineSource: path.resolve(/*turbopackIgnore: true*/ 'engine'),
    // The engine's pose detection, a package of its own (see poseorbit/README.md).
    poseSource: path.resolve(/*turbopackIgnore: true*/ 'poseorbit'),
  }
}

export function defaultModelsDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ 'models')
}

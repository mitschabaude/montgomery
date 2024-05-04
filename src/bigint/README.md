# Bigint operations

This folder contains implementations of many cryptographic primitives on JS bigints.

While these are not the most efficient implementation, they are easy to understand, audit and test.

They serve this library in three ways:

- As a testing ground for PoC implementations of new operations
- As a reference that the more complicated Wasm implementations are compared against for correctness
- As tooling to bootstrap the Wasm implementations, for example, to compute constants that get baked into the Wasm binary.

In the future, these might also be part of a comprehensive bigint-based public API, which converts to Wasm for long computations but stays in bigint land for small ones.

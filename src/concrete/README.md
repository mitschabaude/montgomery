## Concrete curves

This folder contains concrete, immediately usable instantiations -- for particular curves and fields -- of the algorithms and tools montgomery provides.
It also contains, in a separate file, all the parameters defining each curve. The parameters are kept as a separately importable module so that consumers can instantiate different variants of their curve-specific module.

- pasta
- bls12-381
- bls12-377
- ed-on-bls12-377 (twisted edwards curve on the bls12-377 scalar field)

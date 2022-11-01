# ZPrize: Fast MSM in WebAssembly

_by Gregor Mitscha-Baude_

The multi-scalar multiplication (MSM) problem is: Given elliptic curve points $G_i$ and scalars $s_i$, compute

$$S = s_0G_0 + \ldots + s_{n-1} G_{n-1}$$

where $sG$ denotes [scalar multiplication](https://en.wikipedia.org/wiki/Elliptic_curve_point_multiplication). The goal was to compute such an MSM as quickly as possible, in a web browser. The curve is BLS12-381. Nothing about the inputs is known in advance.

Here's the 2-minute summary of my approach:

- It uses a combination of JavaScript and raw WebAssembly text format (WAT)
- The reference implementation was improved by a factor of **5-8x**
- On a reasonable machine, we can do a modular multiplication in < 100ns
- Experimented with Barrett reduction & Karatsuba but ended up sticking to Montgomery which I could make marginally faster
- A crucial insight was to use a non-standard **limb size of 30 bits** for representing field elements, to save carry operations, which are expensive in Wasm
- As probably everyone in this contest, I use Pippenger / the bucket method, with batch-affine additions. I also have NAF scalars, and do GLV decomposition
- An interesting realization was that we can use batch-affine, not just for the bucket accumulation as demonstrated by Aztec, but also for the entire bucket reduction step. Thus, curve arithmetic in my MSM is **99.9% affine**!
- Laying out points in memory in the right order before doing batched additions seems like the way to go

Here are some performance timings, measured in node 16 on the CoreWeave server, by running each instance 10 times and taking the median and standard deviation:

| Size     | Reference (sec) | Ours (sec)      | Speed-up     |
| -------- | --------------- | --------------- | ------------ |
| $2^{14}$ | 2.84 $\pm$ 0.01 | 0.37 $\pm$ 0.01 | $\times$ 7.7 |
| $2^{16}$ | 9.59 $\pm$ 0.17 | 1.38 $\pm$ 0.02 | $\times$ 7.0 |
| $2^{18}$ | 32.9 $\pm$ 0.99 | 4.98 $\pm$ 0.33 | $\times$ 6.6 |

On my local machine (i7), overall performance is a bit better than these numbers, but relative gains somewhat smaller, between 5-6x.

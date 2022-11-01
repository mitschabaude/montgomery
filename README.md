# ZPrize: Fast MSM in WebAssembly

_by Gregor Mitscha-Baude_

The multi-scalar multiplication (MSM) problem is: Given elliptic curve points $G_i$ and scalars $s_i$, compute

$$S = s_0G_0 + \ldots + s_{n-1} G_{n-1}$$

where $sG$ denotes [scalar multiplication](https://en.wikipedia.org/wiki/Elliptic_curve_point_multiplication). The goal was to compute such an MSM as quickly as possible, in a web browser. The curve is BLS12-381. Nothing about the inputs is known in advance.

Here's the 2-minute summary of my approach:

- Written in JavaScript and raw WebAssembly text format (WAT)
- The reference implementation was improved by a factor of **5-8x**
- On a reasonable machine, we can do a modular multiplication in < 100ns
- Experiments with Barrett reduction & Karatsuba, but ended up sticking to Montgomery which I could make marginally faster
- A crucial insight was to use a non-standard **limb size of 30 bits** for representing field elements, to save carry operations, which are expensive in Wasm
- As probably everyone in this contest, I use Pippenger / the bucket method, with batch-affine additions. I also have NAF scalars, and do GLV decomposition
- An interesting realization was that we can use batch-affine, not just for the bucket accumulation as shown by Aztec, but also for the entire bucket reduction step. Thus, curve arithmetic in my MSM is **99.9% affine**!
- Laying out points in memory in the right order before doing batched additions seems like the way to go

Here are some performance timings, measured in node 16 on the CoreWeave server, by running each instance 10 times and taking the median and standard deviation:

| Size     | Reference (sec) | Ours (sec)      | Speed-up     |
| -------- | --------------- | --------------- | ------------ |
| $2^{14}$ | 2.84 $\pm$ 0.01 | 0.37 $\pm$ 0.01 | $\times$ 7.7 |
| $2^{16}$ | 9.59 $\pm$ 0.17 | 1.38 $\pm$ 0.02 | $\times$ 7.0 |
| $2^{18}$ | 32.9 $\pm$ 0.99 | 4.98 $\pm$ 0.33 | $\times$ 6.6 |

On my local machine (Intel i7), overall performance is a bit better than these numbers, but relative gains somewhat smaller, between 5-6x.

## JS vs Wasm

First, a couple of words on the project architecture. I started with a specific assumption into this competition: That, to create code that runs fast in the browser, the best way to go is to just write most of it in JavaScript, and only mix in hand-written Wasm for the low-level arithmetic and some hot loops. This is in contrast to more typical architectures where all the crypto-related code is written in a separate high-level language, and compiled to Wasm with a thin JS/TS wrapper for use in the JS ecosystem. Being a JS developer, who professionally works in a code base where large parts are compiled to JS from OCaml and Rust, I developed a dislike for the impendance mismatch, bad debugging experience, and general complexity such an architecture creates. It's nice if you can click on a function definition and end up _in source code of that function_, not in.. some auto-generated TS declaration file which hides an opaque blob of compiled Wasm. (Looking at layers of glue code and wasm-bindgen incantations, I feel a similar amount of pain for the Rust developer on the other side of the language gap.)

So, I started out just implementing everything from scratch, in JS -- not Wasm yet, because there's no way you're going to find the right sequences of assembly when you are still busy figuring out the mathematics. Then, an interesting game for me was "how much do we have to move to Wasm".

Do you need any Wasm? There's a notion sometimes circling around that WebAssembly isn't really for performance -- it's for language interop; and perfectly-written JS which went through enough JIT cycles would be just as fast. For crypto at least, this is radically false. JS doesn't even have 64-bit integers. The most performant option for multiplication is bigints. They're nice because they make it _simple_:

```js
let z = (x * y) % p;
```

However, one such modular bigint multiplication, for 381-bits inputs, takes 550ns on my machine. The Montgomery multiplication I created in Wasm takes **85ns**!

We definitely want to have multiplication, addition, subtraction and low-level helpers like `isEqual` in WebAssembly, using some custom bytes representation for field elements. The funny thing is that this is basically enough! There are diminishing returns for putting anything else in Wasm than this lowest layer. In fact, I was already close to Arkworks speed at the point where I had _only_ the multiplication in Wasm, and was reading out field element limbs as bigints for routines like subtraction. However, it's slow to read out the field elements. What works well is if JS functions only operate with pointers to Wasm memory, never reading their content ad just passing them from one Wasm function to the next. For the longest time during working on this competition, I had all slightly higher-level functions, like inversion, curve arithmetic etc, written in JS and operate in this way. This was enough to be 3-4x faster than Arkworks, which is all WebAssembly!

Near the end, I put a lot of work into moving more critical path logic to Wasm, but this effort was wasteful. There's zero benefit in moving a routine like `batchInverse` to Wasm -- I'll actually revert changes like that after the competition. The `inverse` function is about the highest level that Wasm should operate on.

## Modular multiplication

Let's start at the lower level of field arithmetic, where I spent a disproportionate amount of time.

Most of my time was spent thinking about, and iterating on, low-level algorithms for field

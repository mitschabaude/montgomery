# ZPrize: Fast MSM in WebAssembly

_by Gregor Mitscha-Baude_

> To get started with the code, see [how to use this repo](#how-to-use-this-repo). To contribute, see [contributing](#contributing)

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

Below, I give a more detailed account of my implementation and convey some of my personal learnings. Further at the bottom, you'll find a section on [how to use this repo](#how-to-use-this-repo).

## JS vs Wasm

First, a couple of words on the project architecture. I started into this competition with a specific assumption: That, to create code that runs fast in the browser, the best way to go is to just write most of it in JavaScript, and only mix in hand-written Wasm for the low-level arithmetic and some hot loops. This is in contrast to more typical architectures where all the crypto-related code is written in a separate high-level language and compiled to Wasm for use in the JS ecosystem. Being a JS developer, who professionally works in a code base where large parts are compiled to JS from OCaml and Rust, I developed a dislike for the impendance mismatch, bad debugging experience, and general complexity such an architecture creates. It's nice if you can click on a function definition and end up _in source code of that function_, not in.. some auto-generated TS declaration file which hides an opaque blob of compiled Wasm. (Looking at layers of glue code and wasm-bindgen incantations, I feel a similar amount of pain for the Rust developer on the other side of the language gap.)

So, I started out by implementing everything from scratch, in JS – not Wasm yet, because it seemed too hard to find the right sequences of assembly when I was still figuring out the mathematics. After having the arithmetic working in JS, an interesting game began: "How much do we have to move to Wasm?"

Do you need any Wasm? There's a notion sometimes circling around that WebAssembly isn't really for performance (it's for bringing other languages to the web); and that perfectly-written JS which went through enough JIT cycles would be just as fast as Wasm. For cryptography at least, this is radically false. JS doesn't even have 64-bit integers. The most performant option for multiplication is bigints. They're nice because they make it simple:

```js
let z = (x * y) % p;
```

However, one such modular bigint multiplication, for 381-bits inputs, takes 550ns on my machine. The Montgomery multiplication I created in Wasm takes **87ns**!

We definitely want to have multiplication, addition, subtraction and low-level helpers like `isEqual` in WebAssembly, using some custom bytes representation for field elements. The funny thing is that this is basically enough! There are diminishing returns for putting anything else in Wasm than this lowest layer. In fact, I was already close to Arkworks speed at the point where I had _only_ the multiplication in Wasm, and was reading out field element limbs as bigints for routines like subtraction. However, it's slow to read out the field elements. What works well is if JS functions only operate with pointers to Wasm memory, never reading their content and just passing them from one Wasm function to the next. For the longest time during working on this competition, I had all slightly higher-level functions, like inversion, curve arithmetic etc, written in JS and operate in this way. This was good enough to be 3-4x faster than Arkworks, which is 100% Wasm!

Near the end, I put a lot of work into moving more critical path logic to Wasm, but this effort was wasteful. There's zero benefit in moving a routine like `batchInverse` to Wasm -- I'll actually revert changes like that after the competition. The `inverse` function is about the highest level that Wasm should operate on.

## 13 x 30 bit multiplication

A major breakthrough in my work was when I changed the size of field elements limbs from 32 to 30 – this decreases the time for a multiplication from 140ns to 87ns. Multiplications are the clear bottleneck at 60%-80% of the total MSM runtime.

To understand why decreasing the limb size has such an impact, or come up with a change like that in the first place, we have to dive into the details of Montgomery multiplication - which I will do now.

Say our prime has bit length $N_p := \lceil\log_2 p\rceil$; in our case, $N_p = 381$. For Montgomery, you choose any bit length $N > N_p$ that suits you, and represent a field element $x'$ by the (completely different) element $x = x' 2^N \pmod{p}$.

The point of this representation is that we can efficiently compute the _Montgomery product_

$$xy 2^{-N} \pmod{p}.$$

The basic idea goes like this: You add a multiple of $p$ which makes $xy$ divisible by $2^N$, so you compute $(xy + qp) 2^{-N}$. We can compute $q$ by $q = (-p^{-1}) xy \pmod{2^N}$. Naively, this idea can be implemented with 3 full bigint multiplications, because $-p^{-1} \bmod{2^N}$ is precomputed, and the $\bmod{2^N}$ and division by $2^N$ are trivial bit operations.

The real algorithm only needs $2 + \epsilon$ multiplications, because the computation of $q$, given $xy$, turns out to be cheap if the division by $2^N$ is done in multiple smaller steps. It starts from the assumption that $x$, $y$ and $p$ are represented as $n$ limbs of $w$ bits each. We call $w$ the _limb size_ or _word size_. In math, we can express this as

$$x = \sum_{i=0}^{n-1}{ x_i 2^{iw} }.$$

We store $x$ as an array of native integers $(x_0,\ldots,x_{n-1})$, and similarly for $y$ and $p$.

Now, the Montgomery radix $2^N$ is chosen as $N = wn$. We can write the Montgomery product as

$$S = xy 2^{-N} =  \sum_{i=0}^{n-1}{ x_i y 2^{iw} 2^{-wn} } = x_0 y 2^{-nw} + x_1 y 2^{-(n-1)w} + \ldots + x_{n-1} y 2^{-w}.$$

We can compute this sum iteratively:

- Initialize $S = 0$
- $S = (S + x_i y) 2^{-w}$ for $i = 0,\ldots,n-1.$

Note that the earlier $x_i$ terms get multiplied by more $2^{-w}$ factors, so at the end it equals the sum $S = xy 2^{-N}$ above. Like $x$ and $y$, $S$ is represented as an array $(S_0, \ldots, S_{n-1})$.

Since we are only interested in the end result modulo p, we are free to modify each step by adding a multiple of p. Similar to the non-iterative algorithm, we do $S = (S + x_i y + q_i p) 2^{-w}$ where $q_i$ is such that $S + x_i y + q_i p = 0 \pmod{2^w}$. It can be found by

$$q_i = (-p^{-1}) (S + x_i y) \pmod{2^w}$$

Now, here comes the beauty: Since this equation is mod $2^w$, which is just the size of a single limb, we can replace all terms by their lowest limbs! For example,

$$y = \sum_{j=0}^{n-1}{ y_j 2^{jw} } = y_0 \pmod{2^w}.$$

Similarly, you can replace $S$ by $S_0$, and $-p^{-1}$ with $\mu_0 := (-p_0^{-1}) \bmod {2^w}$. All in all, finding $q_i$ becomes a computation on integers: $q_i = \mu_0 (S_0 + x_i y_0) \bmod{2^w}$. The constant $\mu_0$ is a pre-computed integer. Fun fact: $q_i$ equals the ith limb of $q$ in the original, non-iterative algorithm (not obvious at this point, and also not important for us).

In full detail, this is the iterative algorithm for the Montgomery product:

- Initialize $S_j = 0$ for $j = 0,\ldots,n-1$
- for $i = 0,\ldots,n-1$, do:
  - $t = S_0 + x_i y_0$
  - $(_-, t') = t$
  - $(_-, q_i) = \mu_0 t'$
  - $(c, _-) = t + q_ip_0$
  - for $j =  1,\ldots,n-1$, do:
    - $(c, S_{j-1}) = S_j + x_i y_j + q_i p_j + c$
  - $S_{n-1} = c$

The $(c, l) = ...$ notation means we split a result in its lower $w$ bits $l$, and any higher bits $c$. The higher bits really represent the number $c 2^w$, which can be carried over by adding $c$ to the next higher term. We'll come back to those carries in a minute.

Note that, in the inner loop, we assign the $S_j$ term to the old $S_{j-1}$ location. Shifting down by one limb like this is equivalent to division by $2^w$.

Also, let's see why the iterative algorithm is much better than the toy algorithm: There, computing $q$ needed a full bigint multiplication, that's $n^2$ integer multiplications. Here, computing all of the $q_i$ only needs $n$ integer multiplications. The rest still needs $2n^2$ multiplications for $x_i y_j + q_i p_j$, so we go from $3 n^2$ to $2 n^2 + n$.

Another note: In the last step, we don't need another carry like $(S_{n},S_{n-1}) = S_{n-1} + c$, if $2p < 2^N$, because we always have $c < 2^w$. This was [shown by the Gnark authors](https://hackmd.io/@gnark/modular_multiplication) and extends to any limb size $w$. This is also why we only need $n$ limbs for storing $S$.

Let's talk about carries, which form a part of this algorithm that is very tweakable. First thing to note is that all of the operations above are implemented on 64-bit integers (`i64` in Wasm). To make multiplications like $x_i y_j$ work, $x_i$ and $y_j$ have to be less than 32 bits, so that their product is less than 32 + 32 = 64 bits. In other words, we need $w \le 32$. In native environments, it seems to be very common to have $w = 32$, presumably because there are efficient ways of multiplying two 32-bit integers, and getting back the high and low 32 bits of the resulting 64 bits.

In WebAssembly, there is no such native "multiply-and-get-carry". Instead, the carry operation $(c, l) = t$ can be implemented with two instructions:

- A right-shift (`i64.shr_u`) of $t$ by the constant $w$, to get $c$
- A bitwise AND (`i64.and`) of $t$ with the constant $2^w - 1$, to get $l$.

Also, every carry is associated with an addition, because $c$ has to be added somewhere. So, we can model the cost of 1 carry as "2 bitwise instructions + 1 addition". Observe that, with the instructions above, there is no efficiency gained by using $w = 32$ – we have to do explicit bit shifting anyway, and could do so by any constant.

Second, with 32-bit limbs, we need to add 1 carry after every product term, because products fill up the full 64 bits. (If we would add two 64-bit terms, we'd get something that can have 65 bits. This would overflow, i.e. the 65th bit gets discarded, giving us wrong results.) It turns out that 1 carry is almost as heavy as 1 mul + add, so doing the carrying on the terms $S + x_i y_j + q_i p_j$ takes up almost half of the runtime!

How many carries do we need for smaller $w$? Let's model this by introducing $K$, defined as the number of _carry-free terms_: the number of product terms we can add (with 64-bit additions) without overflowing 64 bits. For a w-by-w product, we have $xy < 2^{2w}$. We can add $K$ such terms without overflow if $k$ satisfies $k 2^{2w} \le 2^{64}$. Solving for $k$ gives

- $k = 2^0 = 1$ term for $w = 32$
- $k = 2^2 = 4$ terms for $w = 31$
- $k = 2^4 = 16$ terms for $w = 30$
- $k = 2^6 = 64$ terms for $w = 29$
- $k = 2^8 = 256$ terms for $w = 28$

How many terms do we even _have_? In the worst case, during multiplication, $2n$ terms get added up in a row (namely, $x_0y_{n-1} + q_0p_{n-1} + \ldots + x_{n-1}y_0 + q_{n-1}p_0$; any carry terms can be swallowed into our estimate, by doing a closer analysis leveraging that $x,y \le 2^w - 1$, so $xy < 2^{2w} - 2^{w+1}$; an even tighter estimate can use the exact $p_j$ values). The number of limbs $n$ follows from the choice of $w$, by taking the smallest $n$ such that $nw = N > N_p = 381$.
We get

- $w = 32$, $n = 12$, $N = 384$ $\Rightarrow$ max terms: 24, carry-free terms: 1
- $w = 31$, $n = 13$, $N = 403$ $\Rightarrow$ max terms: 26, carry-free terms: 4
- $w = 30$, $n = 13$, $N = 390$ $\Rightarrow$ max terms: 26, carry-free terms: 16
- $w = 29$, $n = 14$, $N = 406$ $\Rightarrow$ max terms: 28, carry-free terms: 64
- $w = 28$, $n = 14$, $N = 392$ $\Rightarrow$ max terms: 28, carry-free terms: 256

We see that starting at $w = 30$, we can eliminate all in-between carries except one, and starting at $w = 29$ we can eliminate all of them. What's always needed is a final carry at the end of each sum of terms, to bring that sum back to within the limb size.

The trade-off with using a smaller limb size is that we get a higher $n$, so the number of multiplications $2n^2$ increases. If two different limb sizes $w$ have the same $n$, the smaller limb size is strictly better (less carries). So, we can immediately rule out the uneven limb sizes $w = 31, 29, \ldots$ because they have the same $n$ as their smaller even neighbours $w = 30, 28, \ldots$.

I did experiments with limb sizes $26$, $28$, $30$ and $32$, and the outcome is what's basically obvious from the manual analysis here: The limb size of 30 bits is our sweet spot, as it gives us the 90/10 benefit on reducing carries while only adding 1 limb vs 32 bits.

Now concretely, how has our algorithm to be modified to use less carries? I'll show the version that's closest to the original algorithm. It has an additional parameter `nSafe` $=k/2$ which is the number of carry-free terms, divided by two. We divide it by two because we have two product terms per iteration ($x_i y_j + q_i p_j$), so `nSafe` is the number of _iterations_ without a carry. A carry is performed in step j of the inner loop, if `j % nSafe === 0`. In particular at step 0 we always perform a carry since we don't store the result, so we couldn't do a carry on it later.

- Initialize $S_j = 0$ for $j = 0,\ldots,n-1$
- for $i = 0,\ldots,n-1$, do:
  - $t = S_0 + x_i y_0$
  - $(_-, t') = t$
  - $(_-, q_i) = \mu_0 t'$
  - $(c, _-) = t + q_ip_0$ (always carry for j=0)
  - for $j =  1,\ldots,n-2$, do:
    - $t = S_j + x_i y_j + q_i p_j$
    - add carry from last iteration:  
      `if ((j-1) % nSafe === 0) ` $t = t + c$
    - maybe do a carry in this iteration:  
      `if (j % nSafe === 0) ` $(c, S_{j-1}) = t$  
      `else ` $S_{j-1} = t$
  - case that the (n-2)th step does a carry:  
    `if ((n-2) % nSafe === 0)`
    - $(c, S_{n-2}) = S_{n-1} + x_i y_{n-1} + q_i p_{n-1}$
    - $S_{n-1} = c$
  - if the (n-2)th step does no carry, then $S_{n-1}$ gets never written to:  
    `else`
    - $S_{n-2} = x_i y_{n-1} + q_i p_{n-1}$
- Final round of carries to get back to $w$ bits per limb:  
  Set $c = 0$.  
  for $i = 0,\ldots,n-1$, do:
  - $(c, S_{i}) = S_{i} + c$

I encourage you to check for yourself that doing a carry every `nSafe` steps of the inner loop is one way to ensure that no more than 2\*`nSafe` product terms are ever added toether.

In the actual implementation, the inner loop is unrolled, so the if conditions can be resolved at _compile time_ and the places where carries happen are hard-coded in the Wasm code.

In our implementation, we use a sort of meta-programming for that: Our Wasm gets created by JavaScript which leverages a little ad-hoc library that mimics the WAT syntax in JS. In fact, the desire to test out implementations for different limb sizes, with complex compile-time conditions like above, was the initial motivation for starting to generate Wasm with JS; before that, I had written it by hand.

My conclusion on this section is that if you implement cryptography in a new environment like Wasm, you have to rederive your algorithms from first principles.
If you just port over well-known algorithms, like the "CIOS method", you will adopt implicit assumptions about what's efficient that went into crafting these algorithms, which might not hold in your environment.

### Barrett vs Montgomery?

I did a lot more experiments trying to find the fastest multiplication algorithm, that I want to mention briefly. Some time during the competition, it came to my attention that there are some [brand-new findings](https://static1.squarespace.com/static/61f7cacf2d7af938cad5b81c/t/62deb4e0c434f7134c2730ee/1658762465114/modular_multiplication.pdf) about _Barrett reduction_, which is a completely different way of reducing products modulo p. This paper, plus some closer analysis done by me within the framework it establishes, reveal that a multiplication + Barrett reduction can be done with an effort of
$$N_\mathrm{barrett} = 2n^2 + 2n + 1$$
integer multiplications. In contrast, as we saw before, a Montgomery multiplication can be done in
$$N_\mathrm{montgomery} = 2n^2 + n$$
integer multiplications. This is sufficiently close that I wanted to implement Barrett (which has similar, but not exactly the same structure), and see if the small difference in multiplication effort might be negligible, or offset by other gains.

An interesting sub-result of my analysis is that for many primes (in particular, ours), we can prove that the maximium error is $e(l) = 1$ (notation/concept from [the paper](https://static1.squarespace.com/static/61f7cacf2d7af938cad5b81c/t/62deb4e0c434f7134c2730ee/1658762465114/modular_multiplication.pdf)). In other words, the result of a Barrett multiplication is a number between 0 and $2p$. This still works if the input factors are themselves in $[0, 2p)$. Thus, we get a product $[0, 2p) \times [0, 2p) \rightarrow [0, 2p)$ and never have to do the full reduction modulo p (except before doing inversions, which needs an input in $[0, p)$). This is exactly the same as for Montgomery reduction! So, the two algorithms can be compared quite well.

An awesome property of Barrett reduction is that it is literally performing the reduction $(x \bmod{p})$, not $(x 2^{-N} \bmod{p})$. So, numbers are not stored in some weird representation like $x 2^N$ -- you just operate on the "normal" numbers. For example, a $1$ will just be an integer array $(1, 0, \ldots, 0)$ instead of some random garbage as for Montgomery. This is clearly nicer for debugging, and might give opportunities to save effort when operating on some common, special numbers. Another nice implication is that we never have to move numbers into or out of their Montgomery representation (which costs 1 Montgomery product per field element). This reduces some effort (~1% in our case) and simplifies the overall algorithm (in our case, by a negligible amount).

Unfortunately, the fastest Barrett multiplication I was able to implement takes 99ns on my machine -- too much of a difference to Montgomery's 87ns to justify the switch. (At least, I could use the Barrett implementation for the GLV decomposition of scalars, where scalars have to be split up modulo the cube root $\lambda$ -- because Barrett works for all moduli, not just primes.)

### Unrolling vs loops

One reason for the "unreasonable effectiveness of Montgomery" I observed is that it can be structured so that all of the work happens in a single outer loop. And, for reasons unclear to me, implementing that outer loop with a Wasm `loop` instruction is much faster than unrolling it; the inner loop, on the other hand, _has_ to be unrolled. Ridiculously, my fully unrolled Montgomery product is 40% slower than the one with an outer loop. Much slower than the Barrett implementations, which are also unrolled. I wasn't able to get any of those voodoo gains by refactoring the Barrett implementation to use loops.

One hint I heard was that V8 (the JS engine) JIT-compiles vectorized instructions if operations are structured in just the right way. I haven't confirmed this myself, and I don't know if that's what's happening here. It would be great to find out, though.

### Karatsuba?

I tried to use one layer of Karatsuba multiplication in the Barrett version. This is straight-forward as for Barrett, the multiplication and the reduction are two clearly separated steps. Karatsuba didn't help, though -- it was exactly as fast as the version with schoolbook multiplication. For Montgomery, I didn't try Karatsuba because I only understood very late that this was even possible. However, given the `loop` paradoxon, and Karatsuba not resulting in a single nice loop, I don't imagine that it can yield any benefits.

## MSM overview

Let's move to the higher-level algorithms for computing the MSM:

$$S = s_0G_0 + \ldots + s_{n-1} G_{n-1}$$

The bucket method and the technique of batching affine additions is well-documented elsewhere, so I'll skip over most details of those.

Broadly, our implementation uses the Pippenger algorithm / bucket method, where scalars are sliced
into windows of size $c$, giving rise to $K = \lfloor b/c \rfloor$ _partitions_ or "sub-MSMs" ($b$ is the scalar bit length).

For each partition k, points $G_i$ are sorted into $L = 2^{c-1}$ _buckets_ according to the ḱth NAF slice of their scalar $s_i$. In total, we end up with $KL$ buckets, which are indexed by $(k, l)$ where $k = 0,\ldots,K-1$ and $l = 1,\ldots,L$.

After sorting the points, computation proceeds in **three main steps:**

1. Each bucket is accumulated into a single point, the _bucket sum_ $B_{l,k}$, which is simply the sum of all points in the bucket.
2. The bucket sums of each partition k are reduced into a partition sum  
   $P_k = 1 B_{k, 1} + 2 B_{k, 2} + \ldots + L B_{k, L}$.
3. the partition sums are reduced into the final result,  
   $S = P_0 + 2^c P_1 + \ldots + 2^{c(K-1)} P_{K-1}$.

We use batch-affine additions for step 1 (bucket accumulation), as pioneered by Zac Williamson in Aztec's barretenberg library: https://github.com/AztecProtocol/barretenberg/pull/19. Thus, in this step we loop over all buckets, collect the pairs of points to add, and then do a batch-addition on all of those. This is done in multiple passes, until the points of each bucket are summed to a single point, in an implicit binary tree. In each pass, empty buckets and buckets with 1 remaining point are skipped; also, buckets of uneven length have a dangling point at the end, which doesn't belong to a pair and is skipped and included in a later pass.

As a novelty, we also use batch-affine additions for _all of step 2_ (bucket reduction). More on that below.

We switch from an affine to a projective point representation between steps 2 and 3. Step 3 is so tiny (< 0.1% of the computation) that the performance of projective curve arithmetic becomes irrelevant.

The algorithm has a significant preparation phase, which happens before step 1, where we split scalars and sort points and such. Before splitting scalars into length-c slices, we do a GLV decomposition, where each 256-bit scalar is split into two 128-bit chunks as $s = s_0 + s_1 \lambda$. Multiplying a point by \lambda is a curve endomorphism, with an efficient implementation

$$\lambda (x,y) = (\beta x, y) =: \mathrm{endo}((x, y)),$$

where $\lambda$ and $\beta$ are certain cube roots of 1 in their respective fields.
Correspondingly, each point $G$ becomes two points $G$, $\mathrm{endo}(G)$. We also store $-G$ and $-\mathrm{endo}(G)$ which are used when the NAF slices of $s_0$, $s_1$ are negative.

Other than processing inputs, the preparation phase is concerned with organizing points. This should be done in a way which:

1. enables to efficiently collect independent point pairs to add, in multiple successive passes over all buckets;
2. makes memory access efficient when batch-adding pairs => ideally, the 2 points that form a pair, as well as consecutive pairs, are stored next to each other.

We address these two goals by copying all points to linear arrays; we do this K times, once for each partition.
Ordering in each of these arrays is achieved by performing a _counting sort_ of all points with respect to their bucket $l$ in partition $k$.

Between steps 1 and 2, there is a similar re-organization step. At the end of step 1, bucket sums are accumulated into the `0` locations of each original bucket, which are spread apart as far as the original buckets were long. Before step 2, we copy these bucket sums to a new linear array from 1 to L, for each partition. Doing this empirically reduces the runtime.

Here's a rough breakdown of the time spent in the 5 different phases of the algorithm. We split the preparation phase into two; the "summation steps" are the three steps also defined above.

| % Runtime | Phase description                                      |
| --------: | ------------------------------------------------------ |
|        8% | Preparation phase 1 - input processing                 |
|       12% | Preparation phase 2 - copying points into bucket order |
|       65% | Summation step 1 - bucket accumulation                 |
|       15% | Summation step 2 - bucket reduction                    |
|        0% | Summation step 3 - final sum over partitions           |

### How to form a valid addition tree

When you have a list of buckets to accumulate – how do you create a series of valid batches of _independent_ additions, such that in the end, you have accumulated those points into one per bucket?

I want to describe this aspect because it's a bit confusing when you first encounter it, and the literature / code comments I found are also confusing, while the actual answer is super simple.

For simplicity, just look at one bucket, with points in an array:

```
x_0 | x_1 | x_2 | x_3 | x_4 | x_5
```

Here's what we do: When we encounter this bucket to collect addition pairs for the first batch, we just greedily take one pair after another, until we run out of pairs:

```
 (x_0, x_1), (x_2, x_3), (x_4, x_5) --> addition pairs
```

For each collected pair, our batch addition routine add-assigns the second to the first point. So, after the first round, we can implicitly ignore every uneven-indexed point, because the entire sum is now contained at the even indices:

```
x_0 | ___ | x_2 | ___ | x_4 | ___
```

When we encounter this bucket for the next addition batch, we again greedily collect pairs starting from index 0. This time, we only have to skip an index every time when we collect a pair. The last point can't be added to a pair, so is skipped:

```
 (x_0, x_2) --> addition pairs
```

After this round `x_2` was added into `x_0`. Now, we can ignore every index not divisible by 4:

```
x_0 | ___ | ___ | ___ | x_4 | ___
```

When collecting points the third round, we take pairs from 4 indices apart at a time, which just gives us the final pair:

```
 (x_0, x_4) --> addition pairs
```

We end up with the final bucket layout, which has all points accumulated into the first one, in a series of independent additions:

```
x_0 | ___ | ___ | ___ | __ | ___
```

When we encounter that bucket in every subsequent round, we will skip it every time because the length is not $> 2^m$, where $m$ is the round number (the first round has $m = 1$).

This trivial algorithm sums up each bucket, in an implicit binary tree, in the minimum possible number of rounds. In the implementation, you walk over all buckets and do what I described here. Simple!

## Affine Addition is All You Need

Let's turn our attention to step 2. At the beginning of this step, we are given bucket sums $B_l$, for $l = 1,\ldots,L$ and the task is compute the _partition sum_

$$P = 1 B_1 + 2 B_2 + \ldots + L B_L = \sum_{1=1}^L l B_l$$

We actually need one such sum for every partition, but they are fully independent, so we are leaving out the $k$ index, $B_l = B_{k,l}$.

There's a well-known algorithm for computing this sum with just $2L$ additions. In pseudo-code:

- Set $R = 0$, $P = 0$.
- for $l = L, \ldots 1$:
  - $R = R + B_l$
  - $P = P + R$

In each step $l$, $R$ becomes the partial sum $R_l := B_L + \ldots + B_l$, and it's easy to see that $P$ is the sum of all those partial sums, $P = R_L + \ldots + R_1$.

Now the obvious question: Can we use batch-affine additions here? Clearly, $P = R_L + \ldots + R_1$, like the bucket sum, can be written as a tree of independent additions, if we'd store the intermediate partial sums $R_l$!

The bad news is that every partial sum depends on the last one: $R_l = R_{l+1} + B_l$. So, these all have to be computed in sequence. Therefore, it seems we can't use batch-affine addition, since we won't amortize the cost of the inversion. We can only batch over the $K$ independent partitions, but that's not enough ($K = \lceil 128 / c\rceil \approx 10$ for the input lengths covered here, and gets smaller for larger inputs).

Let's quickly understand the trade-off with a napkin calculation: With projective arithmetic, we could use mixed additions for all the $R_l = R_{l+1} + B_l$ steps since the $B_l$ is affine. So this addition costs 11 multiplications. Batch additions would only cost 6, plus 1 inversion divided by the batch size $N_b$. One inversion, in our implementation, costs about 100-150 muls, let's say 125, so for batch addition to be faster for computing the $R_l$, we need

$$11 N_b > 125 + 6 N_b \Leftrightarrow N_b > 25.$$

So, it's clearly not worth it to use batch additions here, even if we account for the savings possible in computing $P$.

However, what if we had a way to split the partition sum into independent sub-sums? Actually, we can do this:

$$P = \sum_{l=1}^L l B_l = \sum_{l=1}^{L/2} l B_l + \sum_{l=1}^{L/2} \left( l + \frac{L}{2} \right)  B_{l+L/2}$$

This is just the same sum with the indices written differently: An index $l' > L/2$ is written as $l' = l + L/2$, with $l \le L/2$. Let's split the second sum in two:

$$P = \sum_{l=1}^{L/2} l B_l + \sum_{l=1}^{L/2} l  B_{l+L/2} + \frac{L}{2} \sum_{l=1}^{L/2} B_{l+L/2}$$

Voilà, the first two sums are both of the form of the original parition sum, and they can be computed independently from each other. We have split our two partitions into a lower half $(B_1,\ldots,B_{L/2})$ and an upper half $(B_{L/2 + 1},\ldots,B_L)$. For the extra, third sum, note that if we ignore the ${L/2}$ factor, then the sum is the last partial sum in the upper half. This is computed anyway! We only have to multiply it by $L/2$. Recall that $L = 2^{c-1}$ is a power of 2 – so, the computing that third sum just consists of doing $c-2$ doublings.

In summary, we can split a partition in two independent halves, at the cost of a logarithmic number of doublings, plus 2 additions to add the three sums back together. These extra doublings/additions don't even have to be affine, since they can be done at the end, when we're ready to leave affine land, so they are really negligible.

We don't have to stop there: We can split each of the sub-partitions again, and so on, recursively. We can do this until we have enough independent partitions that the cost of inversions is amortized. This let's us easily amortize the inversion, and we get the full benefit of batch-affine additions when doing the sums $P = R_L + \ldots + R_1$. All-in-all, I think this should save us at least 25% of the effortin the bucket reduction step.

This is implemented in `src/msm.js`, `reduceBucketsAffine`. Unfortunately, I didn't realize until writing this down that the extra doublings/additions don't have to be affine; I use batched-affine for those as well, which is probably just slightly suboptimal. Also, I should add that with a well-chosen window size, the bucket reduction step is 3-5x cheaper than the bucket accumulation step, so shaving off 25% of it ends up saving only <5% of overall runtime.

## How to use this repo

The entry-point for the MSM code used in the competition is [/src/msm.js](src/msm.js). Also in `/src` at the top level there is JS that generates the Wasm output. There are two Wasm modules, one for the base field arithmetic, and one for the scalar decomposition. For each Wasm module we generate 3 artifacts:

- `module-name.wat` -- Wasm in text format. These are designed to be sort of readable, and I looked a lot at them for debugging my Wasm output. They are checked into git, for visibility: [finite-field.wat](src/wasm/finite-field.wat), [scalar-glv.wat](src/wasm/scalar-glv.wat)
- `module-name.wasm.js` -- JS file which contains the Wasm code inlined, as base64 string. It instantiates that Wasm module at the top level, with `await WebAssembly.instantiate(...)`. It then re-exports the Wasm exports. The idea is that this gives the exact same feel and usability as if the Wasm module were a proper ES module. It relies on top-level await, which is natively supported in all major browsers and JS engines, but some bundlers still have problems with it (looking at you, webpack).
- `module-name.wasm` -- Wasm file, which is not used in this repo right now. Once the [Wasm ESM integration](https://github.com/WebAssembly/esm-integration/tree/main/proposals/esm-integration) finally lands, it will be possible to drop-in replace the `.wasm.js` file by the corresponding `.wasm` file. Importing `.wasm` files directly is already supported by some bundlers (like webpack) and in node via the [--experimental-wasm-modules](https://nodejs.org/api/esm.html#wasm-modules) flag.

To build the missing Wasm files, first install the JS dependencies and then run the build script:

```sh
npm i
npm run build
```

At this point, the main library code is usable and can be imported and executed in browser environments and node 19. Earlier node versions only work when your script has an additional code snippet, which provides compatibility with the web crypto API (used for random number generation):

```js
import { webcrypto } from "node:crypto";
globalThis.crypto = webcrypto;
```

To execute most of our benchmark scripts, you additionally need pre-stored random curve points. We load them from a file because recreating them takes extremely long. So, first run the following and go make yourself a cup of coffee:

```sh
node scripts/store-inputs.js 18 # generate 2^18 points
```

After this finished, you're ready to run our benchmarks. The most reliable benchmark, which runs different input sizes multiple times and reports performance statistics, is the following:

```sh
node scripts/evaluate-msm.js
```

The script that I ran most often just runs everything once, but also compares with the reference implementation, and another implementation of mine based on projective arithmetic; also runs some benchmarks of raw multiplication / inversion performance, and reports those numbers together with a breakdown of the multiplication count across parts of the algorithm:

```sh
node index.js
```

You can also vary the MSM input size by using the first CLI parameter:

```sh
node index.js 16 # run msm with 2^16 inputs
```

### Contributing

I hope to polish up this repo to become a go-to library for fast finite field and elliptic curve arithmetic, usable across the JS ecosystem. There is some work to do on this and every contribution is highly welcome 🙌

Specifically, these are major TODOs:

- Give this a proper `package.json` which will make it importable in node projects and major bundlers (that support top-level await)
- Find a good name for an npm library that we can publish this to :D
- Make it usable for arbitrary elliptic curves. This shouldn't be hard because the Wasm generation code is already generic over the prime (and limb size), and the MSM has nothing specific to the curve except for the scalar bit length. So, this is just a matter of organizing the code. The vision is to export the building blocks so that people can build the Wasm module that exactly contains what they need, for their curve of interest. See `createFiniteFieldWat` in [src/finite-field-generate.js](src/finite-field-generate.js).
- Ship pre-generated code for the most popular curves, e.g. BLS12-381, Pasta
- **MAKE THIS FASTER!!** This is supposed to be the fastest possible implementation of everything that's here. Every change that demostrably makes this faster is highly welcome. Known speed TODOs:
  - Refactor the point layout in memory, to use less memory. Right now, we store 64 bit limbs (which only contain 30 non-zero bits), and we store 4 variants of each point. Instead, we should store 32 bits limbs (with 30 non-zero bits) and at most 2 variants of each point (the point and its endo-scaled version; we don't need to store their negatives)
  - Implement a version (should be optional) that uses SIMD instructions
  - Implement a version (should be optional) that is parallelized using Wasm multithreading

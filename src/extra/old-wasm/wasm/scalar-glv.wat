;; generated for w=30, n=5, n*w=150
(module 
  (export "memory" (memory $memory))
  (memory $memory 1024)
  (export "dataOffset" (global $dataOffset))
  (export "barrett" (func $barrett))
  (func $barrett (param $x i32)
    (local $tmp i64) (local $carry i64)
    (local $l00 i64) (local $l01 i64) (local $l02 i64) (local $l03 i64) 
    (local $l04 i64) 
    (local $lp00 i64) (local $lp01 i64) (local $lp02 i64) (local $lp03 i64) 
    (local $lp04 i64) 
    ;; extract l := highest 127 bits of x = x >> 127
    ;; load l := x[4..10] = (x >> 4*30)
    ;; then do l >>= 7 (because 7 = 127 - 4*30)
    (local.set $tmp (i64.extend_i32_u (i32.load offset=16 (local.get $x))))
    (i64.shr_u (local.get $tmp) (i64.const 7))
    (i64.and (i64.shl (local.tee $tmp (i64.extend_i32_u (i32.load offset=20 (local.get $x)))) (i64.const 23)) (i64.const 0x3fffffff))
    i64.or
    (local.set $l00)
    (i64.shr_u (local.get $tmp) (i64.const 7))
    (i64.and (i64.shl (local.tee $tmp (i64.extend_i32_u (i32.load offset=24 (local.get $x)))) (i64.const 23)) (i64.const 0x3fffffff))
    i64.or
    (local.set $l01)
    (i64.shr_u (local.get $tmp) (i64.const 7))
    (i64.and (i64.shl (local.tee $tmp (i64.extend_i32_u (i32.load offset=28 (local.get $x)))) (i64.const 23)) (i64.const 0x3fffffff))
    i64.or
    (local.set $l02)
    (i64.shr_u (local.get $tmp) (i64.const 7))
    (i64.and (i64.shl (local.tee $tmp (i64.extend_i32_u (i32.load offset=32 (local.get $x)))) (i64.const 23)) (i64.const 0x3fffffff))
    i64.or
    (local.set $l03)
    (i64.shr_u (local.get $tmp) (i64.const 7))
    (i64.and (i64.shl (local.tee $tmp (i64.extend_i32_u (i32.load offset=36 (local.get $x)))) (i64.const 23)) (i64.const 0x3fffffff))
    i64.or
    (local.set $l04)
    ;; l = [l * m / 2^N]; the first 3 output limbs are neglected
    (i64.mul (local.get $l00) (i64.const 0xf00fd56))
    (i64.mul (local.get $l01) (i64.const 0x3ac7edca))
    i64.add
    (i64.mul (local.get $l02) (i64.const 0x117b67f7))
    i64.add
    (i64.mul (local.get $l03) (i64.const 0x60713e9))
    i64.add
    (i64.const 30) i64.shr_u
    (i64.mul (local.get $l00) (i64.const 0x2f8d7d9e))
    i64.add
    (i64.mul (local.get $l01) (i64.const 0xf00fd56))
    i64.add
    (i64.mul (local.get $l02) (i64.const 0x3ac7edca))
    i64.add
    (i64.mul (local.get $l03) (i64.const 0x117b67f7))
    i64.add
    (i64.mul (local.get $l04) (i64.const 0x60713e9))
    i64.add
    (i64.const 30) i64.shr_u
    (i64.mul (local.get $l01) (i64.const 0x2f8d7d9e))
    i64.add
    (i64.mul (local.get $l02) (i64.const 0xf00fd56))
    i64.add
    (i64.mul (local.get $l03) (i64.const 0x3ac7edca))
    i64.add
    (i64.mul (local.get $l04) (i64.const 0x117b67f7))
    i64.add
    (local.tee $tmp) (i64.const 0x3fffffff) i64.and
    (local.set $l00)
    (i64.shr_u (local.get $tmp) (i64.const 30))
    (i64.mul (local.get $l02) (i64.const 0x2f8d7d9e))
    i64.add
    (i64.mul (local.get $l03) (i64.const 0xf00fd56))
    i64.add
    (i64.mul (local.get $l04) (i64.const 0x3ac7edca))
    i64.add
    (local.tee $tmp) (i64.const 0x3fffffff) i64.and
    (local.set $l01)
    (i64.shr_u (local.get $tmp) (i64.const 30))
    (i64.mul (local.get $l03) (i64.const 0x2f8d7d9e))
    i64.add
    (i64.mul (local.get $l04) (i64.const 0xf00fd56))
    i64.add
    (local.tee $tmp) (i64.const 0x3fffffff) i64.and
    (local.set $l02)
    (i64.shr_u (local.get $tmp) (i64.const 30))
    (i64.mul (local.get $l04) (i64.const 0x2f8d7d9e))
    i64.add
    (local.tee $tmp) (i64.const 0x3fffffff) i64.and
    (local.set $l03)
    (i64.shr_u (local.get $tmp) (i64.const 30))
    (local.set $l04)
    ;; (l*p)[0..n]
    (i64.mul (local.get $l00) (i64.const 0x3fffffff))
    (local.set $lp00)
    (i64.mul (local.get $l00) (i64.const 3))
    (i64.mul (local.get $l01) (i64.const 0x3fffffff))
    i64.add
    (local.set $lp01)
    (i64.mul (local.get $l00) (i64.const 0x1a4020))
    (i64.mul (local.get $l01) (i64.const 3))
    i64.add
    (i64.mul (local.get $l02) (i64.const 0x3fffffff))
    i64.add
    (local.set $lp02)
    (i64.mul (local.get $l00) (i64.const 0x11690040))
    (i64.mul (local.get $l01) (i64.const 0x1a4020))
    i64.add
    (i64.mul (local.get $l02) (i64.const 3))
    i64.add
    (i64.mul (local.get $l03) (i64.const 0x3fffffff))
    i64.add
    (local.set $lp03)
    (i64.mul (local.get $l00) (i64.const 172))
    (i64.mul (local.get $l01) (i64.const 0x11690040))
    i64.add
    (i64.mul (local.get $l02) (i64.const 0x1a4020))
    i64.add
    (i64.mul (local.get $l03) (i64.const 3))
    i64.add
    (i64.mul (local.get $l04) (i64.const 0x3fffffff))
    i64.add
    (local.set $lp04)
    ;; x|lo = x - l*p to the low n limbs of x
    (i64.extend_i32_u (i32.load offset=0 (local.get $x)))
    (local.get $lp00)
    i64.sub
    (local.set $tmp)
    (i32.store offset=0 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_s (local.get $tmp) (i64.const 30))
    (i64.extend_i32_u (i32.load offset=4 (local.get $x)))
    i64.add
    (local.get $lp01)
    i64.sub
    (local.set $tmp)
    (i32.store offset=4 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_s (local.get $tmp) (i64.const 30))
    (i64.extend_i32_u (i32.load offset=8 (local.get $x)))
    i64.add
    (local.get $lp02)
    i64.sub
    (local.set $tmp)
    (i32.store offset=8 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_s (local.get $tmp) (i64.const 30))
    (i64.extend_i32_u (i32.load offset=12 (local.get $x)))
    i64.add
    (local.get $lp03)
    i64.sub
    (local.set $tmp)
    (i32.store offset=12 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_s (local.get $tmp) (i64.const 30))
    (i64.extend_i32_u (i32.load offset=16 (local.get $x)))
    i64.add
    (local.get $lp04)
    i64.sub
    (local.set $tmp)
    (i32.store offset=16 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    ;; x|hi = l
    (i32.store offset=20 (local.get $x) (i32.wrap_i64 (local.get $l00)))
    (i32.store offset=24 (local.get $x) (i32.wrap_i64 (local.get $l01)))
    (i32.store offset=28 (local.get $x) (i32.wrap_i64 (local.get $l02)))
    (i32.store offset=32 (local.get $x) (i32.wrap_i64 (local.get $l03)))
    (i32.store offset=36 (local.get $x) (i32.wrap_i64 (local.get $l04)))
  )
  (export "multiplySchoolbook" (func $multiplySchoolbook))
  (func $multiplySchoolbook (param $xy i32) (param $x i32) (param $y i32)
    (local $tmp i64)
    (local $x00 i64) (local $x01 i64) (local $x02 i64) (local $x03 i64) 
    (local $x04 i64) 
    (local $y00 i64) (local $y01 i64) (local $y02 i64) (local $y03 i64) 
    (local $y04 i64) 
    (local.set $x00 (i64.extend_i32_u (i32.load offset=0 (local.get $x))))
    (local.set $x01 (i64.extend_i32_u (i32.load offset=4 (local.get $x))))
    (local.set $x02 (i64.extend_i32_u (i32.load offset=8 (local.get $x))))
    (local.set $x03 (i64.extend_i32_u (i32.load offset=12 (local.get $x))))
    (local.set $x04 (i64.extend_i32_u (i32.load offset=16 (local.get $x))))
    (local.set $y00 (i64.extend_i32_u (i32.load offset=0 (local.get $y))))
    (local.set $y01 (i64.extend_i32_u (i32.load offset=4 (local.get $y))))
    (local.set $y02 (i64.extend_i32_u (i32.load offset=8 (local.get $y))))
    (local.set $y03 (i64.extend_i32_u (i32.load offset=12 (local.get $y))))
    (local.set $y04 (i64.extend_i32_u (i32.load offset=16 (local.get $y))))
    ;; multiply in 5x5 steps
    ;; k = 0
    (i64.mul (local.get $x00) (local.get $y00))
    (local.set $tmp)
    (i32.store offset=0 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 1
    (i64.mul (local.get $x00) (local.get $y01))
    i64.add
    (i64.mul (local.get $x01) (local.get $y00))
    i64.add
    (local.set $tmp)
    (i32.store offset=4 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 2
    (i64.mul (local.get $x00) (local.get $y02))
    i64.add
    (i64.mul (local.get $x01) (local.get $y01))
    i64.add
    (i64.mul (local.get $x02) (local.get $y00))
    i64.add
    (local.set $tmp)
    (i32.store offset=8 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 3
    (i64.mul (local.get $x00) (local.get $y03))
    i64.add
    (i64.mul (local.get $x01) (local.get $y02))
    i64.add
    (i64.mul (local.get $x02) (local.get $y01))
    i64.add
    (i64.mul (local.get $x03) (local.get $y00))
    i64.add
    (local.set $tmp)
    (i32.store offset=12 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 4
    (i64.mul (local.get $x00) (local.get $y04))
    i64.add
    (i64.mul (local.get $x01) (local.get $y03))
    i64.add
    (i64.mul (local.get $x02) (local.get $y02))
    i64.add
    (i64.mul (local.get $x03) (local.get $y01))
    i64.add
    (i64.mul (local.get $x04) (local.get $y00))
    i64.add
    (local.set $tmp)
    (i32.store offset=16 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 5
    (i64.mul (local.get $x01) (local.get $y04))
    i64.add
    (i64.mul (local.get $x02) (local.get $y03))
    i64.add
    (i64.mul (local.get $x03) (local.get $y02))
    i64.add
    (i64.mul (local.get $x04) (local.get $y01))
    i64.add
    (local.set $tmp)
    (i32.store offset=20 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 6
    (i64.mul (local.get $x02) (local.get $y04))
    i64.add
    (i64.mul (local.get $x03) (local.get $y03))
    i64.add
    (i64.mul (local.get $x04) (local.get $y02))
    i64.add
    (local.set $tmp)
    (i32.store offset=24 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 7
    (i64.mul (local.get $x03) (local.get $y04))
    i64.add
    (i64.mul (local.get $x04) (local.get $y03))
    i64.add
    (local.set $tmp)
    (i32.store offset=28 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 8
    (i64.mul (local.get $x04) (local.get $y04))
    i64.add
    (local.set $tmp)
    (i32.store offset=32 (local.get $xy) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (i64.shr_u (local.get $tmp) (i64.const 30))
    ;; k = 9
    (local.set $tmp)
    (i32.store offset=36 (local.get $xy) (i32.wrap_i64 (local.get $tmp)))
    (call $barrett (local.get $xy))
  )
  (export "benchMultiplyBarrett" (func $benchMultiplyBarrett))
  (func $benchMultiplyBarrett (param $x i32) (param $N i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (loop 
      (call $multiplySchoolbook (local.get $x) (local.get $x) (local.get $x))
      (br_if 0 (i32.ne (local.get $N) (local.tee $i (i32.add (local.get $i) (i32.const 1)))))
    )
  )
  (export "decompose" (func $decompose))
  (func $decompose (param $x i32)
    (call $barrett (local.get $x))
    (call $reduceByOne (local.get $x))
  )
  (export "decomposeNoMsb" (func $decomposeNoMsb))
  (func $decomposeNoMsb (param $s i32) (result i32)
    (local $flagNegateBoth i32) (local $flagNegateFirst i32)
    ;; if (s1 > lambda) is possible, do s = q - s, flag both points for negation
    (i32.ge_u (i32.load offset=32 (local.get $s)) (i32.const 0x5622))
    (local.tee $flagNegateBoth)
    if (call $negateNoReduceDouble (local.get $s)) end
    ;; split s = s0 + s1*lambda, where s0 < lambda
    (call $barrett (local.get $s))
    (call $reduceByOne (local.get $s))
    ;; if s0 >= 2^(b-1), do s0 = lambda - s0, s1++, flag first point for negation
    (i32.shr_u (i32.load offset=16 (local.get $s)) (i32.const 7))
    (local.tee $flagNegateFirst)
    if (call $negateFirstHalfNoReduce (local.get $s)) end
    (i32.xor (local.get $flagNegateFirst) (local.get $flagNegateBoth))
    (i32.shl (local.get $flagNegateBoth) (i32.const 1))
    i32.or
  )
  (export "reduceByOne" (func $reduceByOne))
  (func $reduceByOne (param $r i32)
    (local $tmp i64) (local $carry i64) (local $l i32)
    (local.set $l (i32.add (local.get $r) (i32.const 20)))
    (block 
      (local.set $tmp (i64.extend_i32_u (i32.load offset=16 (local.get $r))))
      (br_if 1 (i64.lt_u (local.get $tmp) (i64.const 172)))
      (br_if 0 (i64.ne (local.get $tmp) (i64.const 172)))
      (local.set $tmp (i64.extend_i32_u (i32.load offset=12 (local.get $r))))
      (br_if 1 (i64.lt_u (local.get $tmp) (i64.const 0x11690040)))
      (br_if 0 (i64.ne (local.get $tmp) (i64.const 0x11690040)))
      (local.set $tmp (i64.extend_i32_u (i32.load offset=8 (local.get $r))))
      (br_if 1 (i64.lt_u (local.get $tmp) (i64.const 0x1a4020)))
      (br_if 0 (i64.ne (local.get $tmp) (i64.const 0x1a4020)))
      (local.set $tmp (i64.extend_i32_u (i32.load offset=4 (local.get $r))))
      (br_if 1 (i64.lt_u (local.get $tmp) (i64.const 3)))
      (br_if 0 (i64.ne (local.get $tmp) (i64.const 3)))
      (local.set $tmp (i64.extend_i32_u (i32.load offset=0 (local.get $r))))
      (br_if 1 (i64.lt_u (local.get $tmp) (i64.const 0x3fffffff)))
      (br_if 0 (i64.ne (local.get $tmp) (i64.const 0x3fffffff)))
    )
    (local.set $carry (i64.const 0))
    ;; i = 0
    (i64.add (i64.extend_i32_u (i32.load offset=0 (local.get $r))) (local.get $carry))
    (i64.const 0x3fffffff)
    i64.sub
    (local.set $tmp)
    (i32.store offset=0 (local.get $r) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 1
    (i64.add (i64.extend_i32_u (i32.load offset=4 (local.get $r))) (local.get $carry))
    (i64.const 3)
    i64.sub
    (local.set $tmp)
    (i32.store offset=4 (local.get $r) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 2
    (i64.add (i64.extend_i32_u (i32.load offset=8 (local.get $r))) (local.get $carry))
    (i64.const 0x1a4020)
    i64.sub
    (local.set $tmp)
    (i32.store offset=8 (local.get $r) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 3
    (i64.add (i64.extend_i32_u (i32.load offset=12 (local.get $r))) (local.get $carry))
    (i64.const 0x11690040)
    i64.sub
    (local.set $tmp)
    (i32.store offset=12 (local.get $r) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 4
    (i64.add (i64.extend_i32_u (i32.load offset=16 (local.get $r))) (local.get $carry))
    (i64.const 172)
    i64.sub
    (local.set $tmp)
    (i32.store offset=16 (local.get $r) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    (local.set $carry (i64.const 1))
    ;; i = 0
    (i64.add (i64.extend_i32_u (i32.load offset=0 (local.get $l))) (local.get $carry))
    (local.set $tmp)
    (i32.store offset=0 (local.get $l) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 1
    (i64.add (i64.extend_i32_u (i32.load offset=4 (local.get $l))) (local.get $carry))
    (local.set $tmp)
    (i32.store offset=4 (local.get $l) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 2
    (i64.add (i64.extend_i32_u (i32.load offset=8 (local.get $l))) (local.get $carry))
    (local.set $tmp)
    (i32.store offset=8 (local.get $l) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 3
    (i64.add (i64.extend_i32_u (i32.load offset=12 (local.get $l))) (local.get $carry))
    (local.set $tmp)
    (i32.store offset=12 (local.get $l) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 4
    (i64.add (i64.extend_i32_u (i32.load offset=16 (local.get $l))) (local.get $carry))
    (local.set $tmp)
    (i32.store offset=16 (local.get $l) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
  )
  (export "negateNoReduceDouble" (func $negateNoReduceDouble))
  (func $negateNoReduceDouble (param $x i32)
    (local $tmp i64) (local $carry i64)
    ;; x = q - x
    ;; i = 0
    (i64.add (i64.const 1) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=0 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=0 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 1
    (i64.add (i64.const 0x3ffffffc) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=4 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=4 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 2
    (i64.add (i64.const 0x3fe5bfef) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=8 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=8 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 3
    (i64.add (i64.const 0x2f6900bf) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=12 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=12 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 4
    (i64.add (i64.const 0x21d80553) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=16 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=16 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 5
    (i64.add (i64.const 0x27602026) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=20 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=20 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 6
    (i64.add (i64.const 0x17d48333) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=24 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=24 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 7
    (i64.add (i64.const 0x29d4ca67) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=28 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=28 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 8
    (i64.add (i64.const 0x73ed) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=32 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=32 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 9
    (i64.add (i64.const 0) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=36 (local.get $x)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=36 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
  )
  (export "negateFirstHalfNoReduce" (func $negateFirstHalfNoReduce))
  (func $negateFirstHalfNoReduce (param $s0 i32)
    (local $tmp i64) (local $carry i64) (local $s1 i32)
    (local.set $s1 (i32.add (local.get $s0) (i32.const 20)))
    ;; s0 = lambda - s0
    ;; i = 0
    (i64.add (i64.const 0x3fffffff) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=0 (local.get $s0)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=0 (local.get $s0) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 1
    (i64.add (i64.const 3) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=4 (local.get $s0)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=4 (local.get $s0) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 2
    (i64.add (i64.const 0x1a4020) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=8 (local.get $s0)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=8 (local.get $s0) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 3
    (i64.add (i64.const 0x11690040) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=12 (local.get $s0)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=12 (local.get $s0) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 4
    (i64.add (i64.const 172) (local.get $carry))
    (i64.extend_i32_u (i32.load offset=16 (local.get $s0)))
    i64.sub
    (local.set $tmp)
    (i32.store offset=16 (local.get $s0) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; s1 = s1 + 1
    (local.set $carry (i64.const 1))
    ;; i = 0
    (i64.extend_i32_u (i32.load offset=0 (local.get $s1)))
    (local.get $carry)
    i64.add
    (local.set $tmp)
    (i32.store offset=0 (local.get $s1) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 1
    (i64.extend_i32_u (i32.load offset=4 (local.get $s1)))
    (local.get $carry)
    i64.add
    (local.set $tmp)
    (i32.store offset=4 (local.get $s1) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 2
    (i64.extend_i32_u (i32.load offset=8 (local.get $s1)))
    (local.get $carry)
    i64.add
    (local.set $tmp)
    (i32.store offset=8 (local.get $s1) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 3
    (i64.extend_i32_u (i32.load offset=12 (local.get $s1)))
    (local.get $carry)
    i64.add
    (local.set $tmp)
    (i32.store offset=12 (local.get $s1) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
    ;; i = 4
    (i64.extend_i32_u (i32.load offset=16 (local.get $s1)))
    (local.get $carry)
    i64.add
    (local.set $tmp)
    (i32.store offset=16 (local.get $s1) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $carry (i64.shr_s (local.get $tmp) (i64.const 30)))
  )
  (export "toPackedBytes" (func $toPackedBytes))
  ;; converts 5x30-bit representation (1 int64 per 30-bit limb) to packed 16-byte representation
  (func $toPackedBytes (param $bytes i32) (param $x i32)
    (local $tmp i64)
    (i64.shl (i64.extend_i32_u (i32.load offset=0 (local.get $x))) (i64.const 0))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i64.store offset=0 (local.get $bytes) (i64.and (local.get $tmp) (i64.const 0xffffff)))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 24)))
    (i64.shl (i64.extend_i32_u (i32.load offset=4 (local.get $x))) (i64.const 6))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i64.store offset=3 (local.get $bytes) (i64.and (local.get $tmp) (i64.const 0xffffffff)))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 32)))
    (i64.shl (i64.extend_i32_u (i32.load offset=8 (local.get $x))) (i64.const 4))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i64.store offset=7 (local.get $bytes) (i64.and (local.get $tmp) (i64.const 0xffffffff)))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 32)))
    (i64.shl (i64.extend_i32_u (i32.load offset=12 (local.get $x))) (i64.const 2))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i64.store offset=11 (local.get $bytes) (i64.and (local.get $tmp) (i64.const 0xffffffff)))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 32)))
    (i64.shl (i64.extend_i32_u (i32.load offset=16 (local.get $x))) (i64.const 0))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i64.store offset=15 (local.get $bytes) (i64.and (local.get $tmp) (i64.const 0xffffff)))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 24)))
  )
  (export "fromPackedBytes" (func $fromPackedBytes))
  ;; recovers 5x30-bit representation (1 int64 per 30-bit limb) from packed 16-byte representation
  (func $fromPackedBytes (param $x i32) (param $bytes i32)
    (local $tmp i64) (local $chunk i64)
    (local.set $tmp (i64.const 0))
    (i64.shl (local.tee $chunk (i64.load offset=0 (local.get $bytes))) (i64.const 0))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=0 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 30)))
    (i32.store offset=4 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
    (i64.shl (local.tee $chunk (i64.load offset=8 (local.get $bytes))) (i64.const 4))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=8 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 26)))
    (i32.store offset=12 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
    (i64.shl (local.tee $chunk (i64.load offset=16 (local.get $bytes))) (i64.const 8))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=16 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 22)))
  )
  (export "fromPackedBytesDouble" (func $fromPackedBytesDouble))
  ;; recovers 2x5x30-bit representation (1 int64 per 30-bit limb) from packed 2x16-byte representation of a full scalar
  (func $fromPackedBytesDouble (param $x i32) (param $bytes i32)
    (local $tmp i64) (local $chunk i64)
    (local.set $tmp (i64.const 0))
    (i64.shl (local.tee $chunk (i64.load offset=0 (local.get $bytes))) (i64.const 0))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=0 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 30)))
    (i32.store offset=4 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
    (i64.shl (local.tee $chunk (i64.load offset=8 (local.get $bytes))) (i64.const 4))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=8 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 26)))
    (i32.store offset=12 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
    (i64.shl (local.tee $chunk (i64.load offset=16 (local.get $bytes))) (i64.const 8))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=16 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 22)))
    (i32.store offset=20 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
    (i64.shl (local.tee $chunk (i64.load offset=24 (local.get $bytes))) (i64.const 12))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=24 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 18)))
    (i32.store offset=28 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
    (i64.shl (local.tee $chunk (i64.load offset=32 (local.get $bytes))) (i64.const 16))
    (local.get $tmp)
    i64.or
    (local.set $tmp)
    (i32.store offset=32 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $chunk) (i64.const 14)))
    (i32.store offset=36 (local.get $x) (i32.wrap_i64 (i64.and (local.get $tmp) (i64.const 0x3fffffff))))
    (local.set $tmp (i64.shr_u (local.get $tmp) (i64.const 30)))
  )
  (export "extractBitSlice" (func $extractBitSlice))
  (func $extractBitSlice (param $x i32) (param $startBit i32) (param $bitLength i32) (result i32)
    (local $endBit i32) (local $startLimb i32) (local $endLimb i32)
    (local.set $endBit (i32.add (local.get $startBit) (local.get $bitLength)))
    (local.set $startLimb (i32.div_u (local.get $startBit) (i32.const 30)))
    (local.set $startBit (i32.sub (local.get $startBit) (i32.mul (local.get $startLimb) (i32.const 30))))
    (local.set $endLimb (i32.div_u (local.get $endBit) (i32.const 30)))
    (local.set $endBit (i32.sub (local.get $endBit) (i32.mul (local.get $endLimb) (i32.const 30))))
    (i32.gt_u (local.get $endLimb) (i32.const 4))
    if
      (local.set $endBit (i32.const 30))
      (local.set $endLimb (i32.const 4))
    end
    (i32.eq (local.get $startLimb) (local.get $endLimb))
    if
      (i32.load offset=0 (i32.add (local.get $x) (i32.shl (local.get $startLimb) (i32.const 2))))
      (i32.sub (i32.shl (i32.const 1) (local.get $endBit)) (i32.const 1))
      i32.and
      (local.get $startBit)
      i32.shr_u
      return
    end
    (i32.load offset=0 (i32.add (local.get $x) (i32.shl (local.get $startLimb) (i32.const 2))))
    (local.get $startBit)
    i32.shr_u
    (i32.load offset=0 (i32.add (local.get $x) (i32.shl (i32.add (local.get $startLimb) (i32.const 1)) (i32.const 2))))
    (i32.sub (i32.shl (i32.const 1) (local.get $endBit)) (i32.const 1))
    i32.and
    (i32.shl (i32.sub (i32.const 30) (local.get $startBit)))
    i32.or
  )
  (global $dataOffset i32 (i32.const 0))
)

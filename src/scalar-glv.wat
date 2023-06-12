(module
  (type (;0;) (func (param i32 i32 i32) (result i32 i32)))
  (type (;1;) (func (param i32 i32)))
  (type (;2;) (func (param i32 i32 i32) (result i32)))
  (type (;3;) (func))
  (type (;4;) (func (result i32)))
  (func (;0;) (type 0) (param i32 i32 i32) (result i32 i32)
    (local i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64 i64)
    local.get 2
    i32.load
    i64.extend_i32_u
    local.set 4
    local.get 2
    i32.load offset=4
    i64.extend_i32_u
    local.set 5
    local.get 2
    i32.load offset=8
    i64.extend_i32_u
    local.set 6
    local.get 2
    i32.load offset=12
    i64.extend_i32_u
    local.set 7
    local.get 2
    i32.load offset=16
    i64.extend_i32_u
    local.set 8
    local.get 2
    i32.load offset=20
    i64.extend_i32_u
    local.set 9
    local.get 2
    i32.load offset=24
    i64.extend_i32_u
    local.set 10
    local.get 2
    i32.load offset=28
    i64.extend_i32_u
    local.set 11
    local.get 2
    i32.load offset=32
    i64.extend_i32_u
    local.set 12
    local.get 8
    i64.const 88
    i64.mul
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 270886912
    i64.mul
    i64.add
    local.get 9
    i64.const 88
    i64.mul
    i64.add
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 474816911
    i64.mul
    i64.add
    local.get 9
    i64.const 270886912
    i64.mul
    i64.add
    local.get 10
    i64.const 88
    i64.mul
    i64.add
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 439124376
    i64.mul
    i64.add
    local.get 9
    i64.const 474816911
    i64.mul
    i64.add
    local.get 10
    i64.const 270886912
    i64.mul
    i64.add
    local.get 11
    i64.const 88
    i64.mul
    i64.add
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 302697
    i64.mul
    i64.add
    local.get 9
    i64.const 439124376
    i64.mul
    i64.add
    local.get 10
    i64.const 474816911
    i64.mul
    i64.add
    local.get 11
    i64.const 270886912
    i64.mul
    i64.add
    local.get 12
    i64.const 88
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    i64.const 268435456
    i64.and
    i64.const 0
    i64.ne
    i64.extend_i32_u
    i64.add
    local.get 9
    i64.const 302697
    i64.mul
    i64.add
    local.get 10
    i64.const 439124376
    i64.mul
    i64.add
    local.get 11
    i64.const 474816911
    i64.mul
    i64.add
    local.get 12
    i64.const 270886912
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 13
    local.get 10
    i64.const 302697
    i64.mul
    i64.add
    local.get 11
    i64.const 439124376
    i64.mul
    i64.add
    local.get 12
    i64.const 474816911
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 14
    local.get 11
    i64.const 302697
    i64.mul
    i64.add
    local.get 12
    i64.const 439124376
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 15
    local.get 12
    i64.const 302697
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 16
    local.set 17
    local.get 8
    i64.const 536870892
    i64.mul
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 77483007
    i64.mul
    i64.add
    local.get 9
    i64.const 536870892
    i64.mul
    i64.add
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 321548694
    i64.mul
    i64.add
    local.get 9
    i64.const 77483007
    i64.mul
    i64.add
    local.get 10
    i64.const 536870892
    i64.mul
    i64.add
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 487997608
    i64.mul
    i64.add
    local.get 9
    i64.const 321548694
    i64.mul
    i64.add
    local.get 10
    i64.const 77483007
    i64.mul
    i64.add
    local.get 11
    i64.const 536870892
    i64.mul
    i64.add
    i64.const 29
    i64.shr_u
    local.get 8
    i64.const 151348
    i64.mul
    i64.add
    local.get 9
    i64.const 487997608
    i64.mul
    i64.add
    local.get 10
    i64.const 321548694
    i64.mul
    i64.add
    local.get 11
    i64.const 77483007
    i64.mul
    i64.add
    local.get 12
    i64.const 536870892
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    i64.const 268435456
    i64.and
    i64.const 0
    i64.ne
    i64.extend_i32_u
    i64.add
    local.get 9
    i64.const 151348
    i64.mul
    i64.add
    local.get 10
    i64.const 487997608
    i64.mul
    i64.add
    local.get 11
    i64.const 321548694
    i64.mul
    i64.add
    local.get 12
    i64.const 77483007
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 18
    local.get 10
    i64.const 151348
    i64.mul
    i64.add
    local.get 11
    i64.const 487997608
    i64.mul
    i64.add
    local.get 12
    i64.const 321548694
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 19
    local.get 11
    i64.const 151348
    i64.mul
    i64.add
    local.get 12
    i64.const 487997608
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 20
    local.get 12
    i64.const 151348
    i64.mul
    i64.add
    local.tee 3
    i64.const 29
    i64.shr_u
    local.get 3
    i64.const 536870911
    i64.and
    local.set 21
    local.set 22
    local.get 4
    local.get 13
    i64.const 1
    i64.mul
    i64.sub
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store
    local.get 5
    i64.add
    local.get 13
    i64.const 509021752
    i64.mul
    i64.sub
    local.get 18
    i64.const 92880024
    i64.mul
    i64.sub
    local.get 14
    i64.const 1
    i64.mul
    i64.sub
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=4
    local.get 6
    i64.add
    local.get 13
    i64.const 470959455
    i64.mul
    i64.sub
    local.get 18
    i64.const 170284259
    i64.mul
    i64.sub
    local.get 14
    i64.const 509021752
    i64.mul
    i64.sub
    local.get 19
    i64.const 92880024
    i64.mul
    i64.sub
    local.get 15
    i64.const 1
    i64.mul
    i64.sub
    local.get 20
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=8
    local.get 7
    i64.add
    local.get 13
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 18
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 14
    i64.const 470959455
    i64.mul
    i64.sub
    local.get 19
    i64.const 170284259
    i64.mul
    i64.sub
    local.get 15
    i64.const 509021752
    i64.mul
    i64.sub
    local.get 20
    i64.const 92880024
    i64.mul
    i64.sub
    local.get 16
    i64.const 1
    i64.mul
    i64.sub
    local.get 21
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=12
    local.get 8
    i64.add
    local.get 13
    i64.const 1182
    i64.mul
    i64.sub
    local.get 18
    i64.const 1182
    i64.mul
    i64.sub
    local.get 14
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 19
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 15
    i64.const 470959455
    i64.mul
    i64.sub
    local.get 20
    i64.const 170284259
    i64.mul
    i64.sub
    local.get 16
    i64.const 509021752
    i64.mul
    i64.sub
    local.get 21
    i64.const 92880024
    i64.mul
    i64.sub
    local.get 17
    i64.const 1
    i64.mul
    i64.sub
    local.get 22
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=16
    local.get 9
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.sub
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 1182
    i64.mul
    i64.sub
    local.get 19
    i64.const 1182
    i64.mul
    i64.sub
    local.get 15
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 20
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 16
    i64.const 470959455
    i64.mul
    i64.sub
    local.get 21
    i64.const 170284259
    i64.mul
    i64.sub
    local.get 17
    i64.const 509021752
    i64.mul
    i64.sub
    local.get 22
    i64.const 92880024
    i64.mul
    i64.sub
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=20
    local.get 10
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.sub
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.sub
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.get 15
    i64.const 1182
    i64.mul
    i64.sub
    local.get 20
    i64.const 1182
    i64.mul
    i64.sub
    local.get 16
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 21
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 17
    i64.const 470959455
    i64.mul
    i64.sub
    local.get 22
    i64.const 170284259
    i64.mul
    i64.sub
    i64.const 0
    i64.const 509021752
    i64.mul
    i64.sub
    i64.const 0
    i64.const 92880024
    i64.mul
    i64.sub
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=24
    local.get 11
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.sub
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.sub
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.get 15
    i64.const 0
    i64.mul
    i64.sub
    local.get 20
    i64.const 0
    i64.mul
    i64.sub
    local.get 16
    i64.const 1182
    i64.mul
    i64.sub
    local.get 21
    i64.const 1182
    i64.mul
    i64.sub
    local.get 17
    i64.const 221916289
    i64.mul
    i64.sub
    local.get 22
    i64.const 221916289
    i64.mul
    i64.sub
    i64.const 0
    i64.const 470959455
    i64.mul
    i64.sub
    i64.const 0
    i64.const 170284259
    i64.mul
    i64.sub
    i64.const 0
    i64.const 509021752
    i64.mul
    i64.sub
    i64.const 0
    i64.const 92880024
    i64.mul
    i64.sub
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=28
    local.get 12
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.sub
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.sub
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.get 15
    i64.const 0
    i64.mul
    i64.sub
    local.get 20
    i64.const 0
    i64.mul
    i64.sub
    local.get 16
    i64.const 0
    i64.mul
    i64.sub
    local.get 21
    i64.const 0
    i64.mul
    i64.sub
    local.get 17
    i64.const 1182
    i64.mul
    i64.sub
    local.get 22
    i64.const 1182
    i64.mul
    i64.sub
    i64.const 0
    i64.const 221916289
    i64.mul
    i64.sub
    i64.const 0
    i64.const 221916289
    i64.mul
    i64.sub
    i64.const 0
    i64.const 470959455
    i64.mul
    i64.sub
    i64.const 0
    i64.const 170284259
    i64.mul
    i64.sub
    i64.const 0
    i64.const 509021752
    i64.mul
    i64.sub
    i64.const 0
    i64.const 92880024
    i64.mul
    i64.sub
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 0
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=32
    local.set 3
    local.get 3
    i64.const 0
    i64.ne
    if (result i32)  ;; label = @1
      local.get 3
      i64.const -1
      i64.ne
      if  ;; label = @2
        unreachable
      end
      i64.const 1
      i64.const 536870911
      local.get 0
      i32.load
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store
      i64.const 536870911
      local.get 0
      i32.load offset=4
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=4
      i64.const 536870911
      local.get 0
      i32.load offset=8
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=8
      i64.const 536870911
      local.get 0
      i32.load offset=12
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=12
      i64.const 536870911
      local.get 0
      i32.load offset=16
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=16
      i64.const 536870911
      local.get 0
      i32.load offset=20
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=20
      i64.const 536870911
      local.get 0
      i32.load offset=24
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=24
      i64.const 536870911
      local.get 0
      i32.load offset=28
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=28
      i64.const 536870911
      local.get 0
      i32.load offset=32
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 0
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=32
      drop
      i32.const 1
    else
      i32.const 0
    end
    i64.const 0
    local.get 13
    i64.const 0
    i64.mul
    i64.add
    local.get 18
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store
    i64.const 0
    i64.add
    local.get 13
    i64.const 92880024
    i64.mul
    i64.add
    local.get 18
    i64.const 65030864
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.add
    local.get 19
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=4
    i64.const 0
    i64.add
    local.get 13
    i64.const 170284259
    i64.mul
    i64.add
    local.get 18
    i64.const 104372803
    i64.mul
    i64.sub
    local.get 14
    i64.const 92880024
    i64.mul
    i64.add
    local.get 19
    i64.const 65030864
    i64.mul
    i64.sub
    local.get 15
    i64.const 0
    i64.mul
    i64.add
    local.get 20
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=8
    i64.const 0
    i64.add
    local.get 13
    i64.const 221916289
    i64.mul
    i64.add
    local.get 18
    i64.const 443832579
    i64.mul
    i64.sub
    local.get 14
    i64.const 170284259
    i64.mul
    i64.add
    local.get 19
    i64.const 104372803
    i64.mul
    i64.sub
    local.get 15
    i64.const 92880024
    i64.mul
    i64.add
    local.get 20
    i64.const 65030864
    i64.mul
    i64.sub
    local.get 16
    i64.const 0
    i64.mul
    i64.add
    local.get 21
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=12
    i64.const 0
    i64.add
    local.get 13
    i64.const 1182
    i64.mul
    i64.add
    local.get 18
    i64.const 2364
    i64.mul
    i64.sub
    local.get 14
    i64.const 221916289
    i64.mul
    i64.add
    local.get 19
    i64.const 443832579
    i64.mul
    i64.sub
    local.get 15
    i64.const 170284259
    i64.mul
    i64.add
    local.get 20
    i64.const 104372803
    i64.mul
    i64.sub
    local.get 16
    i64.const 92880024
    i64.mul
    i64.add
    local.get 21
    i64.const 65030864
    i64.mul
    i64.sub
    local.get 17
    i64.const 0
    i64.mul
    i64.add
    local.get 22
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=16
    i64.const 0
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.add
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 1182
    i64.mul
    i64.add
    local.get 19
    i64.const 2364
    i64.mul
    i64.sub
    local.get 15
    i64.const 221916289
    i64.mul
    i64.add
    local.get 20
    i64.const 443832579
    i64.mul
    i64.sub
    local.get 16
    i64.const 170284259
    i64.mul
    i64.add
    local.get 21
    i64.const 104372803
    i64.mul
    i64.sub
    local.get 17
    i64.const 92880024
    i64.mul
    i64.add
    local.get 22
    i64.const 65030864
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.add
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=20
    i64.const 0
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.add
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.add
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.get 15
    i64.const 1182
    i64.mul
    i64.add
    local.get 20
    i64.const 2364
    i64.mul
    i64.sub
    local.get 16
    i64.const 221916289
    i64.mul
    i64.add
    local.get 21
    i64.const 443832579
    i64.mul
    i64.sub
    local.get 17
    i64.const 170284259
    i64.mul
    i64.add
    local.get 22
    i64.const 104372803
    i64.mul
    i64.sub
    i64.const 0
    i64.const 92880024
    i64.mul
    i64.add
    i64.const 0
    i64.const 65030864
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.add
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=24
    i64.const 0
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.add
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.add
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.get 15
    i64.const 0
    i64.mul
    i64.add
    local.get 20
    i64.const 0
    i64.mul
    i64.sub
    local.get 16
    i64.const 1182
    i64.mul
    i64.add
    local.get 21
    i64.const 2364
    i64.mul
    i64.sub
    local.get 17
    i64.const 221916289
    i64.mul
    i64.add
    local.get 22
    i64.const 443832579
    i64.mul
    i64.sub
    i64.const 0
    i64.const 170284259
    i64.mul
    i64.add
    i64.const 0
    i64.const 104372803
    i64.mul
    i64.sub
    i64.const 0
    i64.const 92880024
    i64.mul
    i64.add
    i64.const 0
    i64.const 65030864
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.add
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=28
    i64.const 0
    i64.add
    local.get 13
    i64.const 0
    i64.mul
    i64.add
    local.get 18
    i64.const 0
    i64.mul
    i64.sub
    local.get 14
    i64.const 0
    i64.mul
    i64.add
    local.get 19
    i64.const 0
    i64.mul
    i64.sub
    local.get 15
    i64.const 0
    i64.mul
    i64.add
    local.get 20
    i64.const 0
    i64.mul
    i64.sub
    local.get 16
    i64.const 0
    i64.mul
    i64.add
    local.get 21
    i64.const 0
    i64.mul
    i64.sub
    local.get 17
    i64.const 1182
    i64.mul
    i64.add
    local.get 22
    i64.const 2364
    i64.mul
    i64.sub
    i64.const 0
    i64.const 221916289
    i64.mul
    i64.add
    i64.const 0
    i64.const 443832579
    i64.mul
    i64.sub
    i64.const 0
    i64.const 170284259
    i64.mul
    i64.add
    i64.const 0
    i64.const 104372803
    i64.mul
    i64.sub
    i64.const 0
    i64.const 92880024
    i64.mul
    i64.add
    i64.const 0
    i64.const 65030864
    i64.mul
    i64.sub
    i64.const 0
    i64.const 0
    i64.mul
    i64.add
    i64.const 0
    i64.const 1
    i64.mul
    i64.sub
    local.tee 3
    i64.const 29
    i64.shr_s
    local.get 1
    local.get 3
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=32
    local.set 3
    local.get 3
    i64.const 0
    i64.ne
    if (result i32)  ;; label = @1
      local.get 3
      i64.const -1
      i64.ne
      if  ;; label = @2
        unreachable
      end
      i64.const 1
      i64.const 536870911
      local.get 1
      i32.load
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store
      i64.const 536870911
      local.get 1
      i32.load offset=4
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=4
      i64.const 536870911
      local.get 1
      i32.load offset=8
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=8
      i64.const 536870911
      local.get 1
      i32.load offset=12
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=12
      i64.const 536870911
      local.get 1
      i32.load offset=16
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=16
      i64.const 536870911
      local.get 1
      i32.load offset=20
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=20
      i64.const 536870911
      local.get 1
      i32.load offset=24
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=24
      i64.const 536870911
      local.get 1
      i32.load offset=28
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=28
      i64.const 536870911
      local.get 1
      i32.load offset=32
      i64.extend_i32_u
      i64.sub
      i64.add
      local.tee 3
      i64.const 29
      i64.shr_s
      local.get 1
      local.get 3
      i64.const 536870911
      i64.and
      i32.wrap_i64
      i32.store offset=32
      drop
      i32.const 1
    else
      i32.const 0
    end)
  (func (;1;) (type 1) (param i32 i32)
    (local i64 i64)
    local.get 1
    i64.load
    local.tee 3
    i64.const 0
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store
    local.get 3
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=4
    local.get 2
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 1
    i64.load offset=8
    local.tee 3
    i64.const 6
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=8
    local.get 3
    i64.const 23
    i64.shr_u
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=12
    local.get 2
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 1
    i64.load offset=16
    local.tee 3
    i64.const 12
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=16
    local.get 3
    i64.const 17
    i64.shr_u
    local.set 2)
  (func (;2;) (type 1) (param i32 i32)
    (local i64 i64)
    local.get 1
    i64.load
    local.tee 3
    i64.const 0
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store
    local.get 3
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=4
    local.get 2
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 1
    i64.load offset=8
    local.tee 3
    i64.const 6
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=8
    local.get 3
    i64.const 23
    i64.shr_u
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=12
    local.get 2
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 1
    i64.load offset=16
    local.tee 3
    i64.const 12
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=16
    local.get 3
    i64.const 17
    i64.shr_u
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=20
    local.get 2
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 1
    i64.load offset=24
    local.tee 3
    i64.const 18
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=24
    local.get 3
    i64.const 11
    i64.shr_u
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=28
    local.get 2
    i64.const 29
    i64.shr_u
    local.set 2
    local.get 1
    i64.load offset=32
    local.tee 3
    i64.const 24
    i64.shl
    local.get 2
    i64.or
    local.set 2
    local.get 0
    local.get 2
    i64.const 536870911
    i64.and
    i32.wrap_i64
    i32.store offset=32
    local.get 3
    i64.const 5
    i64.shr_u
    local.set 2)
  (func (;3;) (type 2) (param i32 i32 i32) (result i32)
    (local i32 i32 i32)
    local.get 1
    local.get 2
    i32.add
    local.set 3
    local.get 1
    i32.const 29
    i32.div_u
    local.set 4
    local.get 1
    local.get 4
    i32.const 29
    i32.mul
    i32.sub
    local.set 1
    local.get 3
    i32.const 29
    i32.div_u
    local.set 5
    local.get 3
    local.get 5
    i32.const 29
    i32.mul
    i32.sub
    local.set 3
    local.get 5
    i32.const 4
    i32.gt_u
    if  ;; label = @1
      i32.const 29
      local.set 3
      i32.const 4
      local.set 5
    end
    local.get 4
    local.get 5
    i32.eq
    if  ;; label = @1
      local.get 0
      local.get 4
      i32.const 2
      i32.shl
      i32.add
      i32.load
      i32.const 1
      local.get 3
      i32.shl
      i32.const 1
      i32.sub
      i32.and
      local.get 1
      i32.shr_u
      return
    end
    local.get 0
    local.get 4
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.get 1
    i32.shr_u
    local.get 0
    local.get 4
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.const 1
    local.get 3
    i32.shl
    i32.const 1
    i32.sub
    i32.and
    i32.const 29
    local.get 1
    i32.sub
    i32.shl
    i32.or)
  (memory (;0;) 1024)
  (global (;0;) i32 (i32.const 0))
  (export "decompose" (func 0))
  (export "fromPackedBytesSmall" (func 1))
  (export "fromPackedBytes" (func 2))
  (export "extractBitSlice" (func 3))
  (export "memory" (memory 0))
  (export "dataOffset" (global 0)))

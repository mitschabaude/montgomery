(module
  (type (;0;) (func (param i64)))
  (type (;1;) (func (param i32)))
  (type (;2;) (func (param funcref)))
  (type (;3;) (func (param i32 i32) (result i32)))
  (type (;4;) (func))
  (type (;5;) (func (param i32) (result i32)))
  (import "*" "f0" (func (;0;) (type 0)))
  (import "*" "f1" (func (;1;) (type 1)))
  (import "*" "f2" (func (;2;) (type 2)))
  (import "*" "g0" (global (;0;) i64))
  (func (;3;) (type 3) (param i32 i32) (result i32)
    (local i32)
    ref.func 4
    call 2
    global.get 1
    i32.const 0
    call_indirect (type 2)
    local.get 0
    local.get 1
    if  ;; label = @1
      local.get 0
      call 1
    end
    i32.const 2147483647
    i32.const -2147483648
    local.get 1
    select
    call 1
    local.set 2
    local.get 2
    i32.const 5
    call 4
    i32.const 10
    memory.grow
    drop
    i32.const 0
    i32.const 0
    i32.load offset=4
    i32.store
    v128.const i32x4 0x00010000 0x00020000 0x00030000 0x00040000
    v128.const i32x4 0x00000005 0x00000006 0x00000007 0x00000008
    i32x4.add
    drop)
  (func (;4;) (type 3) (param i32 i32) (result i32)
    (local i32 i32)
    f64.const 0x1.2p+0 (;=1.125;)
    i64.trunc_sat_f64_s
    call 0
    i32.const 0
    local.get 0
    i32.add
    local.get 1
    i32.add
    block (param i32) (result i32)  ;; label = @1
      local.tee 2
      call 1
      loop  ;; label = @2
        local.get 3
        call 1
        local.get 3
        i32.const 1
        i32.add
        local.tee 3
        i32.const 5
        i32.eq
        if  ;; label = @3
          local.get 2
          return
          call 1
        end
        br 0 (;@2;)
        local.get 3
        i32.ne
        br_if 0 (;@2;)
      end
      local.get 2
      local.get 2
      drop
    end)
  (table (;0;) 4 funcref)
  (memory (;0;) 1 65536)
  (global (;1;) funcref (ref.func 4))
  (export "exportedFunc" (func 3))
  (export "importedGlobal" (global 0))
  (export "memory" (memory 0))
  (elem (;0;) (i32.const 0) funcref (ref.func 2) (ref.func 4) (ref.null func) (ref.null func))
  (data (;0;) (i32.const 0) "\00\01\02\03\04\05\06\07\08\09\0a\0b"))

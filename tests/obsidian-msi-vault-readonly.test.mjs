import test from "node:test";
import assert from "node:assert/strict";
import {assertApprovedMsiHost} from "../scripts/obsidian-msi-vault-readonly.ts";

test("dry-run requires explicit approved MSI Windows identity",()=>{
  assert.doesNotThrow(()=>assertApprovedMsiHost("win32","MSI"));
  assert.doesNotThrow(()=>assertApprovedMsiHost("win32"," mSi "));
  assert.throws(()=>assertApprovedMsiHost("win32","NAOS-PC"),/restricted/);
  assert.throws(()=>assertApprovedMsiHost("linux","MSI"),/restricted/);
});

test("dry-run rejects accidental other machines even with case-insensitive computer name",()=>{
  for(const h of ["","MSI2","MSI-PC","laptop","naos-pc","MSI\nOTHER"]){
    assert.throws(()=>assertApprovedMsiHost("win32",h),/restricted/);
  }
});

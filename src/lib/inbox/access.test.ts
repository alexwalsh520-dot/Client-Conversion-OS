import { test } from "node:test";
import assert from "node:assert/strict";
import { hasInboxAccess } from "./access";
test("all Coaching members can read the shared inbox",()=>{
  assert.equal(hasInboxAccess({role:"coach",allowedTabs:["/coaching"]}),true);
  assert.equal(hasInboxAccess({role:"admin",allowedTabs:[]}),true);
  assert.equal(hasInboxAccess({role:"sales",allowedTabs:["/sales-hub"]}),false);
  assert.equal(hasInboxAccess(null),false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { getSelectedLanguageCode } from "../src/i18n/language.ts";

test("getSelectedLanguageCode maps regional browser language codes to base options", () => {
	assert.equal(getSelectedLanguageCode("zh-CN"), "zh");
	assert.equal(getSelectedLanguageCode("en-US"), "en");
});

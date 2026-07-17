// The Cement sheet's description text — ONE definition, used by both the Cement
// tab and the export payload so the screen and the workbook can never disagree.
//
// The Cement sheet's description comes from the CEMENT database only. The
// Schedule's rate-book wording is deliberately kept separate: the DSR describes
// the same item twice, in different words. For 4.1.3 the rate book (Vol-1 p.201)
// says "Providing and laying in position cement concrete of specified grade
// excluding the cost of centering and shuttering - ... (zone-III) ...", while the
// Vol-2 coefficient appendix abbreviates to "P/L cement concrete - all works upto
// plinth level : — 1:2:4 (...)" and drops "(zone-III)". Neither is a truncation;
// each is faithful to its own page.
//
//   ticked   -> full_desc  = group_desc + " — " + leaf_desc
//   unticked -> leaf_desc  = the item's own appendix row only
export function cementDescFor(matchInfo, keepFull) {
  if (!matchInfo) return '';
  // `description` is cement_coeff.json's compat alias for full_desc.
  const full = matchInfo.full_desc || matchInfo.description || '';
  const leaf = matchInfo.leaf_desc || '';
  // Fall back to the other field when one is missing — sessions saved before this
  // feature stored only `description`, so leaf_desc can legitimately be absent.
  return keepFull ? (full || leaf) : (leaf || full);
}

// Is "Keep full description" in force for this row?
// The master tick FORCES full on every row; when it is off, each row decides.
export function keepFullFor(rowId, cementFullDesc = {}, cementFullDescAll = false) {
  return !!cementFullDescAll || !!cementFullDesc[rowId];
}

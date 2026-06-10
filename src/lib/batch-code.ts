// Batch codes encode the stream as a free-form token, and the naming
// convention has drifted across cohorts:
//   EnableStudents_11_Photon_Eng_24_N017  → "_Eng_"
//   EnableStudents_12_25_Engg_C08         → "_Engg_"
//   EnableStudents_TP_2027_engg_C027      → "_engg_"
//   EnableStudents_TP_2028_eng_C029       → "_eng_"
//   EnableStudents_TP_2028_med_C028       → "_med_"
// Match all known variants, case-insensitively. This is a stopgap until
// stream lives in batch.metadata (NVS batches already store it there;
// CoE/Nodal batches don't).
export function parseBatchStream(batchId: string): string {
  if (/_engg?_/i.test(batchId)) return "engineering";
  if (/_med_/i.test(batchId)) return "medical";
  return "";
}

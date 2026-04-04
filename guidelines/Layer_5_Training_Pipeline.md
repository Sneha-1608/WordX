# Layer 5: Training Pipeline
## Unsloth QLoRA

---

## Overview

Layer 5 is the **continuous improvement engine** of ClearLingo. It takes human-approved translation corrections collected from the review workflow (Layer 2 → Layer 3) and uses them to fine-tune per-language LoRA adapters via **QLoRA (Quantized Low-Rank Adaptation)** on the **Unsloth** framework. This creates a feedback loop where the system gets better with every human correction.

The pipeline has three stages: **Dataset Collection → QLoRA Fine-Tuning → A/B Testing & Auto-Deploy**.

---

## 5.1 Human Approvals → Dataset Collection

**Purpose:** Accumulate high-quality training pairs from human reviewer corrections.

### Detailed Steps

1. **Data Source — The `revisions` table (Layer 3):**
   - Every time a reviewer modifies a translation before clicking "Approve", both the original LLM output and the human-corrected version are logged.
   - Schema:
     ```sql
     revisions (
       segmentId, originalOutput, humanRevision,
       editDistance, editorId, createdAt
     )
     ```

2. **Dataset Extraction:**
   - Query all revisions where `editDistance > 0` (i.e., the human actually changed something).
   - Filter by language pair to create per-language datasets.
   - Format into training pairs:
     ```json
     {
       "input": "Translate to Hindi: 'Please verify your account details before proceeding.'",
       "output": "आगे बढ़ने से पहले अपनी नेटवर्क स्थिति जांचें।"
     }
     ```

3. **Quality Filters:**
   - Exclude revisions with very high edit distance (likely full rewrites, not corrections).
   - Exclude revisions from flagged reviewers (quality control).
   - Minimum dataset size: **500 pairs** before triggering a training run.
   - Include the glossary context and style profile in the input to teach the model to follow constraints.

4. **Dataset Format:**
   - Instruction-tuning format compatible with Unsloth/Hugging Face:
     ```json
     [
       {
         "instruction": "Translate the following text from English to Hindi. Use glossary: Government=सरकार. Tone: Professional.",
         "input": "The government has released new guidelines.",
         "output": "सरकार ने नए दिशानिर्देश जारी किए हैं।"
       }
     ]
     ```

5. **Versioning:**
   - Each dataset extraction is versioned with a timestamp.
   - Previous datasets are archived, not deleted.
   - Training metadata tracks which dataset version produced which adapter.

---

## 5.2 QLoRA Fine-Tuning (30 min/GPU)

**Purpose:** Train lightweight LoRA adapters on the collected dataset using quantized training for GPU efficiency.

### Detailed Steps

1. **Framework: Unsloth**
   - Unsloth is a fast fine-tuning library optimized for LoRA/QLoRA training.
   - It provides 2–5x speedup over standard Hugging Face training.
   - Supports 4-bit quantization (QLoRA), reducing GPU memory requirements.

2. **Base Model Selection:**
   - The base model for fine-tuning is selected based on the target language.
   - For Indian languages: a multilingual model like `ai4bharat/IndicTrans2` or a multilingual Gemma variant.
   - For European languages: a model compatible with Gemini-style outputs.

3. **QLoRA Configuration:**
   ```python
   from unsloth import FastLanguageModel

   model, tokenizer = FastLanguageModel.from_pretrained(
       model_name = "base-model-name",
       max_seq_length = 2048,
       dtype = None,          # Auto-detect
       load_in_4bit = True,   # QLoRA 4-bit quantization
   )

   model = FastLanguageModel.get_peft_model(
       model,
       r = 16,                # LoRA rank
       target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"],
       lora_alpha = 16,
       lora_dropout = 0,
       bias = "none",
       use_gradient_checkpointing = True,
   )
   ```

4. **Training Parameters:**

   | Parameter | Value |
   |---|---|
   | LoRA rank (r) | 16 |
   | LoRA alpha | 16 |
   | Training epochs | 3 |
   | Batch size | 4 |
   | Learning rate | 2e-4 |
   | Quantization | 4-bit (QLoRA) |
   | Max sequence length | 2048 tokens |
   | Training time | ~30 minutes on a single GPU |
   | GPU memory required | ~8 GB (thanks to 4-bit quantization) |

5. **Training Execution:**
   ```python
   from transformers import TrainingArguments
   from trl import SFTTrainer

   trainer = SFTTrainer(
       model = model,
       tokenizer = tokenizer,
       train_dataset = dataset,
       args = TrainingArguments(
           per_device_train_batch_size = 4,
           num_train_epochs = 3,
           learning_rate = 2e-4,
           output_dir = f"./lora-adapters/{source_lang}-{target_lang}",
       ),
   )
   trainer.train()
   ```

6. **Adapter Output:**
   - The training produces a small LoRA adapter file (~50 MB) instead of a full model copy.
   - Saved to `./lora-adapters/{source_lang}-{target_lang}/` directory.
   - Adapter files: `adapter_config.json` + `adapter_model.bin`.

---

## 5.3 A/B Testing & Auto-Deploy

**Purpose:** Validate that the new LoRA adapter actually improves translation quality before deploying to production.

### Detailed Steps

1. **A/B Test Setup:**
   - Hold out 20% of the training dataset as a test set.
   - Translate the test set using **both**:
     - Model A: Base model (without LoRA adapter)
     - Model B: Base model + new LoRA adapter

2. **Evaluation Metrics:**

   | Metric | Description | Target |
   |---|---|---|
   | **BLEU Score** | N-gram overlap with human reference | Higher is better |
   | **Edit Distance** | Levenshtein distance from human reference | Lower is better |
   | **Glossary Compliance** | % of required terms present | 99.8%+ |
   | **Human Preference** | Blind A/B reviewer preference | >60% prefer B |

3. **Auto-Deploy Decision Logic:**
   ```
   IF new_adapter.bleu_score > base_model.bleu_score + 0.02
   AND new_adapter.glossary_compliance >= 0.998
   AND new_adapter.edit_distance < base_model.edit_distance
   THEN auto_deploy(new_adapter)
   ELSE flag_for_manual_review()
   ```

4. **Deployment Process:**
   - Copy the adapter files to the production adapter directory.
   - Update the adapter registry (a JSON config file) to point to the new version.
   - Layer 4 loads the updated adapter on the next translation request.
   - Previous adapter versions are kept for rollback capability.

5. **Rollback Safety:**
   - If the new adapter causes issues in production (detected via analytics in Layer 6), the system can roll back to the previous adapter version instantly.
   - Each adapter is tagged with a version number and deployment timestamp.

---

## Pipeline Lifecycle Diagram

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   HUMAN REVIEWS  │     │  QLoRA TRAINING   │     │   A/B TESTING    │
│                  │     │                  │     │                  │
│ Reviewer edits   │────►│ Unsloth 4-bit    │────►│ Compare vs base  │
│ translations     │     │ 30 min/GPU       │     │ model quality    │
│ Revisions saved  │     │ LoRA rank=16     │     │ BLEU, glossary   │
│ to SQLite        │     │ ~50MB adapter    │     │ edit distance    │
└──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                           │
                                                    Passes? │
                                                    ┌──────┴──────┐
                                                    │             │
                                                   YES           NO
                                                    │             │
                                              Auto-Deploy    Manual Review
                                              to Layer 4     & Flag
```

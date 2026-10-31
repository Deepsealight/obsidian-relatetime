# RelateTime - Dynamic Character Relationship Timeline Graph

**RelateTime** is an Obsidian core plugin designed specifically for creators, web novelists, and world-builders. Built on React and a high-performance D3.js physics engine, it transforms dull Markdown text attributes into a **dynamic character relationship network that flows with time**.

This plugin was created by an Agent.

Through an original "Hybrid Deterministic Engine + LLM Global Knowledge Graph Completion" system, RelateTime can automatically infer complex kinship, academic (mentor/disciple), and in-law relationships you haven't explicitly written, while warning you of logical or gender contradictions.

---
<img width="2448" height="1520" alt="image" src="https://github.com/user-attachments/assets/760fc1ac-8a86-400c-a1c9-4d41a5fd3e92" />


## ✨ Core Features

### 🕰️ Ultra-Precision Timeline
- **BC/BCE Support**: Supports an infinite time span from 3000 BC to the far future, whether it's prehistoric times, cultivation eras, or interstellar futures.
- **Dynamic Infinite Zoom**: Seamlessly zoom from a "Decade View (100 years)" down to an "Hour View (down to a specific date and hour)".
- **Synchronized State Flow**: Drag the timeline, and the graph will display the exact character relationships active at that specific point in time in real-time.

### 🧠 Hybrid Inference Engine
- **100% Stable Local Rule Engine**: Automatically implements deterministic logic such as siblings, shared parents, and shared mentors with zero latency and absolute consistency.
- **LLM Global Graph Completion**: Connects to OpenAI-compatible LLM APIs (like gpt-4o or local LM Studio). The model analyzes the entire network to infer cross-generational (grandparents/grand-disciples), collateral (uncles/aunts), and in-law (sister-in-law/parents-in-law) relationships.
- **Two Inference Modes**: Choose between "Show Partial Inference (core direct lines and closed loops only)" and "Show Full Inference (including collateral and cross-generational)" to prevent link explosion.

### 🛡️ Smart Ethical Conflict Detection
- Automatically verifies if the "Gender" attribute in the note matches the provided "Relationship Title".
- When logical contradictions occur (e.g., set as male but filled in as a wife; or generational seniority crossing), the graph highlights **red warning links**. Hover over them to see a detailed conflict analysis Tooltip.

### 🎨 Optimized D3 Geometric Rendering
- **Flow Slot Anti-Overlap Layout**: Multiple relationship links (e.g., two people are both spouses and mentor/disciple) are automatically spread out in parallel with fixed spacing. Text staggers along the link direction, completely eliminating text overlap.
- **Smart Unidirectional Merging**: Identical reciprocal relationships (e.g., "Friend ⇄ Friend", "Peer ⇄ Peer") are intelligently folded into a single solid line with bidirectional arrows, keeping the graph clean.
- **Deep Customizable Appearance**: Fully restores and enhances Obsidian's native graph physics settings (centripetal force, repulsion, link distance, etc.) and supports pixel-level adjustments for node size, line width, and opacity at various levels.

---

## 📦 Installation

*(Note: Once approved in the Obsidian Community Plugins directory, you can search for RelateTime and install it directly within the app.)*

**Manual Installation:**
1. Go to the [Releases page](https://github.com/Deepsealight/obsidian-relatetime/releases) of the GitHub repository.
2. Download the `main.js`, `manifest.json`, and `styles.css` files from the latest release.
3. Create a folder named `relatetime` inside your Obsidian vault's `.obsidian/plugins/` directory, and place the downloaded files inside.
4. Restart Obsidian, and enable **RelateTime** in `Settings -> Community Plugins`.

---

## 🚀 Quick Start

### 1. Complete the Character Card (Frontmatter)
In your Obsidian notes, ensure you include the following YAML Frontmatter attributes:

```yaml
---
type: Character
character-name: Venti
性别: 男 (Male)
关系: 张三 - 师父（2020-08-13 BC 1:00 ～ 2024-08-26 BC 17:00），李四-夫妻（2025-08-13 BC 13:00:00 ～ 2025-08-26 BC 13:00:00）、赵五 -大哥（固定）
---
```

*(Note: The attribute name and value for `type` can be customized in the plugin settings.)*

**Relationships:**

Dates can be AD (without BC), and times can be omitted. For relationships that do not change over time, use **(固定)** (Fixed) to denote them.

For example, the attribute `张三 - 师父（2020-08-13 BC 1:00 ～ 2024-08-26 BC 17:00）` indicates that from 2020-08-13 BC 1:00 to 2024-08-26 BC 17:00, **张三** (Zhang San) is the **"师父"** (Mentor) of **this file**.

### 2. Configure LLM (Optional, for global deep inference)

1. Open the RelateTime plugin settings page.
2. Locate the **LLM Relationship Inference Settings**.
3. Enter your API URL (local model addresses are supported) and API Key.
4. Enter the model name (e.g., `gpt-4o-mini`) and click "hi测试" (Test Connection) to verify connectivity.
5. Click **"AI 重新推演关系"** (AI Re-infer Relationships) in the top-left corner of the graph to generate global high-level relationships with one click.

### 3. Graph Operations

- Click the **"Relationship Network"** icon in the left sidebar to open the view.
- **Drag the bottom timeline ruler** to pan through time.
- **Scroll the mouse wheel** to zoom in/out on timeline precision.
- **Click a node** to lock focus. The **right-side menu** provides powerful search (displaying neighbors as well) and appearance customization features.

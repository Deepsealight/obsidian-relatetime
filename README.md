# RelateTime - Character Relationship Timeline Inference Graph

**English** · [简体中文](README.zh-CN.md)

**RelateTime** is an Obsidian plugin designed for creators, web novel writers, and worldbuilders. Built with React and a high-performance D3.js physics engine, it turns dry Markdown text properties into a **dynamic character relationship graph that evolves over time**.

This plugin was created by an Agent.

With its original “hybrid deterministic engine + LLM-based global knowledge graph completion,” RelateTime can automatically complete complex kinship, fellow-disciple, and in-law relationships that you have not written out, and warn you when logical or gender contradictions occur.

---

<img src="https://github.com/user-attachments/assets/e38b42ab-1cfe-4171-8066-6d85891878ee" style="width: 100%; height: auto;" alt="RelateTime Demo" />

<img src="https://github.com/user-attachments/assets/cebb7756-39bc-4249-9c26-a6e88c189a85" style="width: 100%; height: auto;" alt="RelateTime Demo" />


## ✨ Features

### 🕰️ Full-Scale Ultra-Precision Timeline
- **BC/BCE support**: Whether it is prehistoric times, a cultivation era, or an interstellar future, it supports an unlimited span from 3000 BC to the future.
- **Seamless dynamic zoom**: Smoothly zoom from “century view (100 years)” all the way down to “hour view (down to a specific date and hour).”
- **Synchronized state transitions**: Drag the timeline and the graph displays the character relationships that are exactly active at that point in time.

### 🧠 Hybrid Inference Engine
- **100% stable local rule engine**: Automatically infers mutual sibling relationships, shared-parent relationships, shared masters among fellow disciples, and other deterministic logic with zero latency and absolutely consistent results.
- **LLM Integration for global graph completion**: Connect to an OpenAI-compatible LLM API (such as gpt-4o or a local LM Studio instance). The model analyzes the entire character network and automatically infers cross-generational (grandparent–grandchild / master's master), collateral (uncles/aunts), and in-law (elder brother's wife / parents-in-law / wife's elder brother) relationships.
- **Two inference modes**: Choose “Show partial inferences (core direct-line and closed-loop relationships only)” or “Show all inferences (including collateral and cross-generational relationships)” to avoid an explosion of edges.

### 🛡️ Intelligent Conflict Detection
- Automatically verifies whether the “gender” property in a note matches the recorded relationship label.
- When a logical contradiction occurs (for example, gender is set to male but the character is recorded in the wife role; or generation/seniority relationships conflict and overlap), the graph highlights the edge with a **red warning line**. Hover over it to view a detailed conflict analysis tooltip.

### 🎨 Optimized D3 Geometric Rendering
- **Flow-slot anti-overlap layout**: Multiple relationship edges (such as two people being both spouses and master-disciple) are automatically laid out in parallel at fixed intervals, and labels are staggered along the edge direction to completely eliminate text overlap.
- **Smart single-line bidirectional merging**: Reciprocal identical relationships (such as “friend ⇄ friend” and “fellow disciple ⇄ fellow disciple”) are intelligently collapsed into a single solid line with bidirectional arrows, keeping the graph clean and clear.
- **Deeply customizable appearance**: Fully restores and enhances Obsidian's native graph physics settings (centering force, repulsion force, link distance, etc.), and supports pixel-level adjustments for node size, line width, and opacity at each hierarchy level.

---

## 📦 Installation

**RelateTime is now available in the Obsidian Community Plugin marketplace. You can search for RelateTime and install it directly in the app.**

**Manual installation:**
1. Go to the GitHub repository's [Releases page](https://github.com/your-username/obsidian-relatetime/releases).
2. Download the latest `RelateTime.zip`.
3. Extract it and place the `relatetime` folder into the `.obsidian/plugins/` folder in your Obsidian vault.
4. Restart Obsidian and enable **RelateTime** under `Settings -> Third-party plugins`.

---

## 🚀 Usage

### 1. Complete character cards (Frontmatter)
In your Obsidian notes, make sure to include the following YAML Frontmatter properties:

```yaml
---
type: 人物
character-name: 温迪
性别: 男
关系: 张三 - 师父（2020-08-13 BC 1:00 ～ 2024-08-26 BC 17:00），李四-夫妻（2025-08-13 BC 13:00:00 ～ 2025-08-26 BC 13:00:00）、赵五 -大哥（固定）
---
```

*(Note: Both the property name and property value of `type` can be customized in the plugin settings. The example above uses the default Chinese property names.)*

**Relationships:**

Dates may be CE/AD (without BC), may omit hours and minutes, and relationships that do not change over time can be marked with **`(固定)`** (fixed).

For example, `张三 - 师父（2020-08-13 BC 1:00 ～ 2024-08-26 BC 17:00）` means that from 2020-08-13 BC 1:00 to 2024-08-26 BC 17:00, **张三** is the **“master”** of **this file**.

### 2. Configure the LLM (for global deep inference)

- Open the RelateTime plugin settings page.
- Find **LLM Relationship Inference Settings**.
- Enter your API URL (local model addresses are supported) and API Key.
- Enter the model name (such as `gpt-4o-mini`), then click **Hi Test** (`hi测试`) to verify connectivity.
- Click **AI Re-infer Relationships** (`AI 重新推演关系`) in the upper-left corner of the graph to generate high-level global relationships in one click.

### 3. Operate the graph and list

- Click the **Relationship Network** icon in the left sidebar to open the view.
- **Drag the bottom ruler** to pan through time.
- **Scroll the mouse wheel** to zoom in/out on the timeline precision.
- **Click a node** to lock focus. The **right-side menu** provides powerful search (showing neighbors) and appearance customization.
- **List view**: In the list page, a relationship entry indicates that the character at the top is the [relationship] of the character on the left.

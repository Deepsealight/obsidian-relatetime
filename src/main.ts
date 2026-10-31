import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, ItemView, requestUrl } from 'obsidian';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import RelateTime from './RelateTime';

export const VIEW_TYPE_RELATE_TIME = 'relate-time-view';
export const DEFAULT_LLM_PROMPT = `你是一个严谨的小说人物关系全局知识图谱补全与逻辑冲突检测引擎。
我将提供一组人物列表（characters：包含 id、name、gender）以及手动填写的显式关系列表（explicitRelations：包含 key、sourceId、sourceName、sourceGender、targetId、targetName、targetGender、label、timeStr）。
其中每条显式关系表示：source 是 target 的 [label]（例如：温迪 是 主角 的 妻子）。

请你完成以下两项核心任务并严格输出 JSON：

### 任务一：显式关系核验 (items)
针对每一条输入的显式关系：
1. 【性别与伦理冲突检测 (conflictReason)】：
   - 若 sourceGender 为"男"，但 label 是女性专属称谓（如妻子/老婆/母亲/妈妈/姐姐/妹妹/女儿/师姐/师妹/女友/大嫂等），必须标记冲突并写明原因，例如："性别冲突：【温迪】的性别为「男」，但被填写为【主角】的「妻子」。"
   - 若 sourceGender 为"女"，但 label 是男性专属称谓（如丈夫/老公/父亲/爸爸/大哥/哥哥/弟弟/儿子/师兄/师弟/男友/姐夫等），同样标记冲突并写明原因。
   - 若无冲突，conflictReason 填空字符串 ""。
2. 【语义分类归一化 (category)】：
   - 配偶类统一为 "spouse"；亲生手足类为 "sibling"；父母子女类为 "parent_child"；师徒类为 "master_disciple"；同门师兄弟类为 "martial_sibling"；朋友类为 "friend"；同门类为 "sect_peer"；仇敌类为 "enemy"；祖孙类为 "grandparent"；叔伯姑姨舅甥类为 "uncle_aunt"；姻亲类为 "in_law"；其余为 "custom_" + 原词。
3. 【直接反向称谓 (reverseLabel)】：
   - 结合 targetGender（男/女/未知）推算 target 是 source 的什么称谓（绝不含"推算"二字）。

### 任务二：全人物跨节点传递推算 (globalInferredRelations)
请基于所有显式关系构建全局家族树与门派谱系，推算出任意两个人物之间未显式书写、但可通过逻辑传递得出的隐含关系（包含正反双向）：
1. 【严格区分推算层级 (scope)】：
   - "partial"（核心直系与同门闭环）：
     * 亲生兄弟姐妹传递（A与B是兄弟姐妹，B与C是兄弟姐妹 => A与C是兄弟姐妹）；
     * 手足共享父母（A与B是亲兄弟姐妹，P是A的父亲/母亲 => P也是B的父亲/母亲，B是P的儿子/女儿）；
     * 父母共享子女（P同时是A和B的亲生父母 => A与B是兄弟姐妹）；
     * 夫妻共享亲生子女（F是C的父亲，M是F的妻子 => M是C的母亲，C是M的儿子/女儿）；
     * 同师父门下闭环（M同时是A和B的师父 => A与B互为同门）。
   - "all"（旁系、跨代与姻亲扩展推算）：
     * 跨代祖孙：父母的父母 => 祖父/祖母/外公/外婆（反向：孙子/孙女/外孙/外孙女）；师父的师父 => 师祖（反向：徒孙）；
     * 旁系叔伯舅姑姨：父亲的兄弟 => 伯父/叔父（反向：侄子/侄女）；母亲的兄弟 => 舅舅（反向：外甥/外甥女）；同门师兄弟的徒弟 => 师叔/师伯（反向：师侄）；
     * 姻亲关系：哥哥的妻子 => 嫂子/大嫂（反向：小叔子/小姑子）；姐姐的丈夫 => 姐夫；妻子的父母 => 岳父/岳母（反向：女婿）；丈夫的父母 => 公公/婆婆（反向：儿媳）；妻子的兄弟 => 大舅哥/小舅子（反向：妹夫/姐夫）。
2. 【绝对禁止乱传递的红线规则】：
   - 朋友、好友、知己、仇人、死敌、宿敌、暗恋、上司/下属 等非传递性关系，绝对禁止跨节点传递！（例如：A和B是朋友，B和C是朋友，绝不能推算A和C是朋友；A是B的哥哥，B和C是朋友，绝不能推算A和C有关系）。
   - 姻亲绝不可乱传为直系血亲！（例如：温迪是主角的妻子，张宇是温迪的大哥，张宇只能是主角的"大舅哥/妻兄"[scope="all"]，绝不是主角的親大哥！）。

请严格只输出合法的 JSON 对象，格式如下：
{
  "items": [
    {
      "key": "原样返回输入的key",
      "category": "语义分类",
      "reverseLabel": "直接反向称谓",
      "conflictReason": "冲突原因或空字符串"
    }
  ],
  "globalInferredRelations": [
    {
      "sourceId": "人物A的id",
      "targetId": "人物B的id",
      "label": "推算出的称谓(表示sourceId是targetId的什么人，不含推算二字)",
      "category": "语义分类(如 parent_child / sibling / grandparent / in_law 等)",
      "scope": "partial 或 all",
      "timeStr": "固定"
    }
  ]
}`;

export interface RelateTimeSettings {
  targetFolder: string;
  attrKey: string;
  attrValue: string;
  llmUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmPrompt: string;
  llmCache: {
    fingerprint: string;
    semanticMap: Record<string, { category: string; reverseLabel: string; conflictReason: string }>;
    globalInferred: any[]; // 确保这里不是可选的 (?)，并声明为 any[]
    updatedAt: number;
  };
  uiState: Record<string, any>; // 确保 uiState 的类型正确
}

export const DEFAULT_SETTINGS: RelateTimeSettings = {
  targetFolder: '人物',
  attrKey: 'type',
  attrValue: '人物',
  llmUrl: '',
  llmApiKey: '',
  llmModel: '',
  llmPrompt: DEFAULT_LLM_PROMPT,
  llmCache: {
    fingerprint: '',
    semanticMap: {},
    globalInferred: [], // 现在与接口匹配了
    updatedAt: 0,
  },
  uiState: {},
};

export class RelateTimeView extends ItemView {
  plugin: RelateTimePlugin;
  root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelateTimePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_RELATE_TIME;
  }

  getDisplayText() {
    return '人物关系时间轴';
  }

  // 更换为与原生关系图谱 (git-fork) 不同的专属网络图标
  getIcon() {
    return 'network';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.height = '100%';
    container.style.padding = '0';
    container.style.overflow = 'hidden';
    this.root = createRoot(container);
    this.root.render(React.createElement(RelateTime, { plugin: this.plugin }));
  }

  async onClose() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}

export default class RelateTimePlugin extends Plugin {
  settings: RelateTimeSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_RELATE_TIME, (leaf) => new RelateTimeView(leaf, this));

    // 使用专属的 network 图标，与原生关系图谱区分
    this.addRibbonIcon('network', '打开人物关系时间轴', () => {
      this.activateView();
    });

    this.addSettingTab(new RelateTimeSettingTab(this.app, this));
  }

  async activateView() {
    const { workspace } = this.app;
    // 将类型声明改为包含 undefined
    let leaf: WorkspaceLeaf | null | undefined = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_RELATE_TIME);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf(true);
      // 只有在 leaf 存在时才进行状态设置
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_RELATE_TIME, active: true });
      }
    }
    
    // 只有在 leaf 存在时才 reveal
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    // 兼容旧版默认填入的示例值，若用户未主动配置 Key 且为旧默认值则清空
    if (this.settings.llmUrl === 'https://api.openai.com/v1/chat/completions' && !this.settings.llmApiKey) {
      this.settings.llmUrl = '';
    }
    if (this.settings.llmModel === 'gpt-4o-mini' && !this.settings.llmUrl && !this.settings.llmApiKey) {
      this.settings.llmModel = '';
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class RelateTimeSettingTab extends PluginSettingTab {
  plugin: RelateTimePlugin;

  constructor(app: App, plugin: RelateTimePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '人物关系时间轴 - 基础设置' });

    new Setting(containerEl)
      .setName('目标文件夹路径')
      .setDesc('读取人物笔记的文件夹路径')
      .addText((text) =>
        text
          .setPlaceholder('例如: Scrivener联动/便笺')
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value) => {
            this.plugin.settings.targetFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('人物筛选属性名 (Key)')
      .setDesc('Front Matter 中标识人物卡片的属性名')
      .addText((text) =>
        text
          .setPlaceholder('例如: type')
          .setValue(this.plugin.settings.attrKey)
          .onChange(async (value) => {
            this.plugin.settings.attrKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('人物筛选属性值 (Value)')
      .setDesc('Front Matter 中标识人物卡片的属性值')
      .addText((text) =>
        text
          .setPlaceholder('例如: 人物')
          .setValue(this.plugin.settings.attrValue)
          .onChange(async (value) => {
            this.plugin.settings.attrValue = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ---------------- 大模型设置区块 ----------------
    containerEl.createEl('h2', { text: '大模型 (LLM) 关系推演设置' });

    new Setting(containerEl)
      .setName('API URL')
      .setDesc('大模型接口地址（默认留空，仅当填写后启用大模型增强分析）')
      .addText((text) => {
        text
          .setPlaceholder('例如: https://api.openai.com/v1/chat/completions')
          .setValue(this.plugin.settings.llmUrl)
          .onChange(async (value) => {
            this.plugin.settings.llmUrl = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.style.width = '300px';
      });

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('接口密钥（以 ••• 掩码方式隐藏显示，本地免密接口可留空）')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.style.width = '240px';
        text
          .setPlaceholder('请输入 API Key (sk-...)')
          .setValue(this.plugin.settings.llmApiKey)
          .onChange(async (value) => {
            this.plugin.settings.llmApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('模型名称 (Model) 与连通性测试')
      .setDesc('填写模型名称，点击右侧「hi测试」按钮验证配置是否可用')
      .addText((text) => {
        text
          .setPlaceholder('例如: agnes-3.0-flash 或 gpt-4o-mini')
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings.llmModel = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.style.width = '220px';
      })
      .addButton((btn) =>
        btn
          .setButtonText('hi测试')
          .setCta()
          .onClick(async () => {
            const url = this.plugin.settings.llmUrl.trim();
            const key = this.plugin.settings.llmApiKey.trim();
            const model = this.plugin.settings.llmModel.trim();

            if (!url) {
              new Notice('⚠️ 请先填写 API URL');
              return;
            }
            if (!model) {
              new Notice('⚠️ 请先填写模型名称 (Model)');
              return;
            }

            btn.setButtonText('测试中...');
            btn.setDisabled(true);

            try {
              let endpoint = url;
              if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/completions')) {
                endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
              }

              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
              };
              if (key) {
                headers['Authorization'] = `Bearer ${key}`;
              }

              const res = await requestUrl({
                url: endpoint,
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model,
                  messages: [{ role: 'user', content: 'hi' }],
                  max_tokens: 16,
                  temperature: 0,
                }),
              });

              const reply = res.json?.choices?.[0]?.message?.content || '收到响应';
              new Notice(`✅ 模型连接成功！回复: "${String(reply).slice(0, 30)}"`, 4500);
            } catch (err: any) {
              console.error('LLM hi测试失败:', err);
              const errMsg = err?.message || String(err);
              new Notice(`❌ 模型连接失败: ${errMsg}`, 5000);
            } finally {
              btn.setButtonText('hi测试');
              btn.setDisabled(false);
            }
          })
      );

    new Setting(containerEl)
      .setName('关系推演提示词 (System Prompt)')
      .setDesc('指导大模型结合人物性别进行关系推算与冲突检测的系统提示词')
      .addTextArea((area) => {
        area
          .setPlaceholder('请输入系统提示词...')
          .setValue(this.plugin.settings.llmPrompt)
          .onChange(async (value) => {
            this.plugin.settings.llmPrompt = value;
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 10;
        area.inputEl.style.width = '100%';
        area.inputEl.style.fontFamily = 'monospace';
        area.inputEl.style.fontSize = '12px';
      });

    new Setting(containerEl)
      .setName('提示词与缓存管理')
      .setDesc('将提示词恢复为系统默认，或清除已保存的分析缓存')
      .addButton((btn) =>
        btn.setButtonText('恢复默认提示词').onClick(async () => {
          this.plugin.settings.llmPrompt = DEFAULT_LLM_PROMPT;
          await this.plugin.saveSettings();
          this.display();
          new Notice('✅ 已恢复默认提示词');
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText('清空分析缓存')
          .setWarning()
          .onClick(async () => {
            // 补上 globalInferred: []
            this.plugin.settings.llmCache = { fingerprint: '', semanticMap: {}, globalInferred: [], updatedAt: 0 };
            await this.plugin.saveSettings();
            new Notice('🗑️ 已清空分析缓存');
          })
      );
  }
}
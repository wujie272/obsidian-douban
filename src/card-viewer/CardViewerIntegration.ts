import { App, Plugin, MarkdownPostProcessorContext } from "obsidian";
import { CardType, CardRenderer, DEFAULT_SETTINGS } from "./types/index";
import { createCardRenderer } from "./renderers/cardRenderer";

/**
 * 将 Card Viewer 的渲染能力集成进 Douban 插件
 * 无需额外安装 card-viewer 插件
 */
export class CardViewerIntegration {
	private cardRenderer!: CardRenderer;

	constructor(private app: App, private plugin: Plugin) {
		this.cardRenderer = createCardRenderer(app, () => ({
			posterAltMode: DEFAULT_SETTINGS.posterAltMode,
		}));
	}

	/**
	 * 注册所有卡片代码块处理器
	 * 支持 card-movie / card-tv / card-book / card-music
	 */
	registerProcessors(): void {
		const cardTypes: CardType[] = ["movie", "tv", "book", "music"];

		cardTypes.forEach((type) => {
			(this.plugin as any).registerMarkdownCodeBlockProcessor(
				`card-${type}`,
				(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) =>
					this.renderCard(type, source, el, ctx),
			);
		});

		// 同时注册 post processor 兼容 ```card-xxx 语法高亮模式
		this.plugin.registerMarkdownPostProcessor(
			(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				this.processCardBlocks(el, ctx);
			},
		);
	}

	private async renderCard(
		type: string,
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		try {
			// 清理字段前导逗号（豆瓣数据问题）
			const lines = source.split("\n");
			const cleaned = lines
				.map((line) => {
					const match = line.match(/^(\w+):\s*(.*)$/);
					if (match) {
						return `${match[1]}: ${match[2].replace(/^[,，]+\s*/, "")}`;
					}
					return line;
				})
				.join("\n");

			await this.cardRenderer.renderCard(type, cleaned, el, ctx);
		} catch (e) {
			el.createEl("div", {
				text: `卡片渲染失败: ${(e as Error).message}`,
				cls: "card-viewer-error",
			});
		}
	}

	private async processCardBlocks(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const codeBlocks = el.querySelectorAll(
			'pre > code[class*="language-card-"]',
		);
		for (const block of Array.from(codeBlocks)) {
			const htmlBlock = block as HTMLElement;
			const match = htmlBlock.className.match(/language-card-([a-z]+)/);
			if (!match) continue;

			const cardType = match[1];
			const code = htmlBlock.textContent || "";
			const pre = htmlBlock.parentElement;
			if (!pre?.parentNode) continue;

			const container = document.createElement("div");
			await this.renderCard(cardType, code, container, ctx);
			pre.parentNode.replaceChild(container, pre);
		}
	}
}

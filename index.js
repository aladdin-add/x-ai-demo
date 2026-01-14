import { chromium } from 'playwright';
import OpenAI from 'openai';

// 配置 OpenAI (请确保环境变量中有 OPENAI_API_KEY)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // 如果使用中转服务，可能需要配置 baseURL
    // baseURL: "https://your-proxy-domain.com/v1"
});

/**
 * 核心函数：在浏览器环境中精简 HTML
 * 目的：大幅减少 Token 消耗，保留关键语义信息
 */
function simplifyDOM() {
    // 1. 克隆 body 防止破坏页面
    const clone = document.body.cloneNode(true);

    // 2. 移除无关标签 (脚本, 样式, SVG, 图片内容等)
    const tagsToRemove = ['script', 'style', 'noscript', 'iframe', 'svg', 'link', 'meta'];
    tagsToRemove.forEach(tag => {
        const elements = clone.querySelectorAll(tag);
        elements.forEach(el => el.remove());
    });

    // 3. 递归清理属性 (只保留有助于定位的属性)
    const allowedAttributes = ['id', 'class', 'name', 'placeholder', 'aria-label', 'role', 'type', 'href', 'title', 'alt'];

    function cleanElement(el) {
        if (el.nodeType === 1) { // 元素节点
            const attrs = Array.from(el.attributes);
            for (const attr of attrs) {
                if (!allowedAttributes.includes(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            }
            // 如果元素没有文本内容且没有关键属性，可以考虑进一步移除（视情况而定）
        }

        // 递归处理子节点
        let child = el.firstChild;
        while (child) {
            const next = child.nextSibling;
            if (child.nodeType === 1) {
                cleanElement(child);
            } else if (child.nodeType === 3) {
                // 压缩空白文本节点
                if (!child.nodeValue.trim()) {
                    el.removeChild(child);
                }
            } else {
                el.removeChild(child); // 移除注释等其他节点
            }
            child = next;
        }
    }

    cleanElement(clone);
    return clone.innerHTML; // 返回精简后的 HTML 字符串
}

/**
 * 主流程函数
 */
async function getElementSelector(url, description) {
    console.log(`正在启动浏览器访问: ${url}`);
    const browser = await chromium.launch({ headless: false }); // headless: false 方便调试观察
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // 等待一下，确保动态元素加载（简单粗暴的方法，生产环境建议用 waitForLoadState）
        await page.waitForTimeout(2000);

        // 步骤 1: 获取精简后的 HTML
        console.log("正在提取并精简 DOM...");
        const simplifiedHTML = await page.evaluate(simplifyDOM);

        // 如果 HTML 依然过长，可能需要截断 (防止超出 Token 限制)
        // 实际生产中可能需要分块处理或使用 Snapshot
        const truncatedHTML = simplifiedHTML.slice(0, 15000);

        // 步骤 2: 构建 Prompt
        const prompt = `
        You are a QA automation expert. I will provide you with a simplified HTML snippet of a webpage.
        
        Your task is to find the CSS Selector for the element described as: "${description}".
        
        Rules:
        1. Return ONLY the CSS selector string. No markdown, no explanations.
        2. Prefer 'id' if available, otherwise use a unique combination of classes or attributes.
        3. Make the selector robust.
        
        HTML Snippet:
        ${truncatedHTML}
        `;

        console.log("正在调用 AI 模型...");

        // 步骤 3: 调用 LLM
        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-4o", // 使用智能程度较高的模型
            temperature: 0,  // 设为 0 保证结果确定性
        });

        const selector = completion.choices[0].message.content.trim();
        console.log(`AI 返回的选择器: ${selector}`);

        // 步骤 4: (可选) 在页面上验证高亮
        const count = await page.locator(selector).count();
        if (count > 0) {
            console.log(`验证成功: 页面上找到了 ${count} 个匹配元素。即将高亮...`);
            await page.locator(selector).first().highlight();
            await page.waitForTimeout(3000); // 停留展示
        } else {
            console.warn(`警告: AI 返回的选择器 "${selector}" 在页面上未找到元素。`);
        }

        return selector;

    } catch (error) {
        console.error("发生错误:", error);
    } finally {
        await browser.close();
    }
}

// --- 执行示例 ---
(async () => {
    // 示例：获取百度首页的输入框
    const url = 'https://www.baidu.com';
    const target = '搜索输入框'; // 或者 "The main search input box"

    const selector = await getElementSelector(url, target);
    console.log(`最终结果: ${selector}`);
})();
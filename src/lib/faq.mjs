import data from '../../data/faq.json' with { type: 'json' };

export const faq = data;
export const faqPage = {
  route: '/faq/',
  title: 'Clash 常见问题 FAQ：订阅失败、无法联网、DNS 与 TUN 排查',
  description: '按现象排查 Clash 与 Mihomo 常见问题：安装包选择、订阅导入失败、节点超时、系统代理不生效、退出后断网、DNS 和 TUN 异常。提供检查顺序、相关教程与项目文档。',
  nav: 'faq',
  modified: data.updated,
  schema: [{
    '@type': 'FAQPage',
    name: 'Clash 与 Mihomo 常见问题',
    inLanguage: 'zh-CN',
    dateModified: data.updated,
    mainEntity: data.questions.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: [item.answer, ...item.steps].join(' ') },
    })),
  }],
};

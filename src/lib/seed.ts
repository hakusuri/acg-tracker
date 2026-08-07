import type { WorkInput } from '../types';
import { insertWork } from './db';

const SEED: Array<Omit<WorkInput, 'source'>> = [
  {
    title: '新世纪福音战士', category: 'anime', year: 1995, season: 'autumn', status: 'completed',
    total_count: 26, current_count: 26, rating: 9.2, my_rating: 9.5,
    synopsis: '少年少女驾驶 EVA 对抗使徒，在末日背景下探讨自我与孤独。', tags: '科幻,机战,心理', notes: '', cover_path: '', links: '', 
  },
  {
    title: '命运石之门', category: 'anime', year: 2011, season: 'spring', status: 'completed',
    total_count: 24, current_count: 24, rating: 9.1, my_rating: 9.8,
    synopsis: '自称疯狂科学家的冈部伦太郎偶然发明了向过去发送短信的方法，却卷入世界的因果。', tags: '科幻,悬疑,时间旅行', notes: '', cover_path: '', links: '',
  },
  {
    title: '葬送的芙莉莲', category: 'anime', year: 2023, season: 'autumn', status: 'completed',
    total_count: 28, current_count: 28, rating: 9.0, my_rating: 9.6,
    synopsis: '勇者一行讨伐魔王后，长生的精灵魔法使芙莉莲踏上重新认识人类的旅途。', tags: '奇幻,治愈,冒险', notes: '', cover_path: '', links: '',
  },
  {
    title: '进击的巨人 最终季', category: 'anime', year: 2020, season: 'winter', status: 'watching',
    total_count: 28, current_count: 16, rating: 8.7, my_rating: null,
    synopsis: '墙内人类与巨人战斗的故事进入终章，真相逐渐浮出水面。', tags: '热血,黑暗,战斗', notes: '等完结再补', cover_path: '', links: '',
  },
  {
    title: '间谍过家家', category: 'anime', year: 2022, season: 'spring', status: 'on_hold',
    total_count: 12, current_count: 5, rating: 7.8, my_rating: null,
    synopsis: '间谍、杀手与超能力少女组成的临时家庭，彼此隐瞒身份共同生活。', tags: '搞笑,日常,家庭', notes: '', cover_path: '', links: '',
  },
  {
    title: '海贼王', category: 'anime', year: 1999, season: 'autumn', status: 'watching',
    total_count: 1116, current_count: 1080, rating: 8.4, my_rating: 8.0,
    synopsis: '路飞与伙伴们为了成为海贼王而踏上伟大航路的冒险故事。', tags: '热血,冒险,长篇', notes: '', cover_path: '', links: '',
  },
  {
    title: '钢之炼金术师', category: 'manga', year: 2001, season: null, status: 'completed',
    total_count: 27, current_count: 27, rating: 9.3, my_rating: 9.7,
    synopsis: '爱德华与阿尔冯斯兄弟为了找回失去的身体，追寻贤者之石的真相。', tags: '奇幻,冒险,神作', notes: '', cover_path: '', links: '',
  },
  {
    title: '一拳超人', category: 'manga', year: 2012, season: null, status: 'watching',
    total_count: 28, current_count: 21, rating: 8.0, my_rating: 8.5,
    synopsis: '最强的光头英雄埼玉，任何敌人都接不住他的一拳。', tags: '搞笑,战斗,英雄', notes: '', cover_path: '', links: '',
  },
  {
    title: '刀剑神域', category: 'light_novel', year: 2009, season: null, status: 'completed',
    total_count: 28, current_count: 28, rating: 8.0, my_rating: 8.2,
    synopsis: '被困在 VRMMO 中的玩家们为了生存而战斗，桐人与亚丝娜的命运就此展开。', tags: '网游,战斗,恋爱', notes: '', cover_path: '', links: '',
  },
  {
    title: '冰菓', category: 'light_novel', year: 2001, season: null, status: 'planned',
    total_count: 6, current_count: 0, rating: 8.6, my_rating: null,
    synopsis: '节能主义者折木奉太郎在古典部邂逅好奇少女千反田爱瑠，卷入一个个日常谜题。', tags: '校园,推理,日常', notes: '', cover_path: '', links: '',
  },
  {
    title: 'CLANNAD', category: 'galgame', year: 2004, season: null, status: 'completed',
    total_count: 10, current_count: 10, rating: 9.0, my_rating: 9.9,
    synopsis: '在冈崎朋也与古河渚相遇之后，一段关于亲情与小镇的催泪故事。', tags: '催泪,恋爱,人生', notes: '', cover_path: '', links: '',
  },
  {
    title: '白色相簿2', category: 'galgame', year: 2010, season: null, status: 'completed',
    total_count: 6, current_count: 6, rating: 8.8, my_rating: 9.3,
    synopsis: '在音乐社团中交织的三角恋，被誉为脱宅神作与脱团神作。', tags: '恋爱,致郁,胃疼', notes: '', cover_path: '', links: '',
  },
  {
    title: 'Ever17 -the out of infinity-', category: 'galgame', year: 2002, season: null, status: 'on_hold',
    total_count: 6, current_count: 3, rating: 8.5, my_rating: null,
    synopsis: '海底主题公园遭遇事故，被困的七人要在 119 小时内逃出生天。', tags: '悬疑,科幻,叙诡', notes: '第三路线中', cover_path: '', links: '',
  },
];

export async function seedSampleData(): Promise<number> {
  let count = 0;
  for (const item of SEED) {
    await insertWork({ ...item, source: 'manual' });
    count++;
  }
  return count;
}
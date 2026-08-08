import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import WorkForm from '../components/WorkForm';
import type { WorkFormPrefill } from '../components/WorkForm';
import { downloadCover, searchBangumi, searchVndb } from '../lib/api';
import type { ApiRequestConfig } from '../lib/api';
import { useSettings } from '../lib/settings';
import { CATEGORIES, CATEGORY_LABELS, SEASONS, SEASON_LABELS, STATUSES, STATUS_LABELS } from '../lib/constants';
import { insertWork, listWorks } from '../lib/db';
import { normalizeTitle, parseBangumiCsv, parseMalXml, seasonFromDate } from '../lib/importers';
import type { BangumiItem, Category, ImportRow, Season, Status, VndbItem } from '../types';

type Tab = 'file' | 'api';
type ApiSource = 'bangumi' | 'vndb';
type ApiCategory = 'all' | Category;

const API_CATEGORIES: Array<{ key: ApiCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'anime', label: '番剧' },
  { key: 'manga', label: '漫画' },
  { key: 'light_novel', label: '轻小说' },
  { key: 'galgame', label: 'Galgame' },
];

function bangumiTypes(cat: ApiCategory): number[] {
  switch (cat) {
    case 'anime':
      return [2];
    case 'manga':
    case 'light_novel':
      return [1];
    case 'galgame':
      return [4];
    default:
      return [];
  }
}

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>('file');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileKind, setFileKind] = useState<'mal' | 'bangumi' | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [apiSource, setApiSource] = useState<ApiSource>('bangumi');
  const [apiCategory, setApiCategory] = useState<ApiCategory>('all');
  const [keyword, setKeyword] = useState('');
  const [apiResults, setApiResults] = useState<BangumiItem[] | VndbItem[] | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [prefill, setPrefill] = useState<WorkFormPrefill | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const { settings } = useSettings();

  // 搜索始终全类别；展示结果按当前类别实时筛选
  const shownApiResults = useMemo(() => {
    if (!apiResults) return null;
    if (apiSource === 'bangumi' && apiCategory !== 'all') {
      const allowed = bangumiTypes(apiCategory);
      return apiResults.filter((it) => allowed.includes((it as BangumiItem).btype));
    }
    return apiResults;
  }, [apiResults, apiSource, apiCategory]);

  const pickFile = async (kind: 'mal' | 'bangumi') => {
    const file = await open({
      multiple: false,
      filters:
        kind === 'mal'
          ? [{ name: 'MAL 导出 XML', extensions: ['xml'] }]
          : [{ name: 'Bangumi CSV', extensions: ['csv', 'txt'] }],
    });
    if (typeof file !== 'string') return;
    setBusy(true);
    setMessage('');
    try {
      const text = await readTextFile(file);
      const parsed = kind === 'mal' ? parseMalXml(text) : parseBangumiCsv(text);
      if (parsed.length === 0) {
        setRows([]);
        setFileKind(null);
        setMessage('未解析到任何作品记录，请检查文件是否为有效的导出文件');
        return;
      }
      const existing = await listWorks();
      const normalized = new Set(existing.map((w) => `${normalizeTitle(w.title)}|${w.year ?? ''}`));
      setRows(
        parsed.map((r) => {
          const conflict = normalized.has(`${normalizeTitle(r.title)}|${r.year ?? ''}`);
          return { ...r, conflict, selected: !conflict };
        }),
      );
      setFileKind(kind);
      setMessage(`解析出 ${parsed.length} 条记录，重复项默认跳过`);
    } catch (e) {
      setRows([]);
      setFileKind(null);
      setMessage(`读取或解析失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (idx: number, patch: Partial<ImportRow>) => {
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const toggleAll = (checked: boolean) => {
    setRows((list) => list.map((r) => ({ ...r, selected: checked })));
  };

  const doImport = async () => {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) return;
    setBusy(true);
    try {
      let count = 0;
      for (const r of selected) {
        await insertWork({
          title: r.title,
          category: r.category,
          year: r.year,
          season: r.category === 'anime' ? r.season : null,
          status: r.status,
          total_count: r.total_count,
          current_count: r.current_count,
          rating: r.rating,
          my_rating: r.my_rating,
          synopsis: r.synopsis,
          tags: r.tags,
          notes: r.notes,
          cover_path: r.cover_path,
          links: r.links,
          source: r.source,
        });
        count++;
      }
      setRows([]);
      setFileKind(null);
      setMessage(`成功导入 ${count} 条记录`);
    } catch (e) {
      setMessage(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doSearch = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    setApiLoading(true);
    setApiError('');
    setApiResults(null);
    try {
      const cfg: ApiRequestConfig = {
        limit: settings.searchLimit,
        apiBase: apiSource === 'bangumi' ? settings.bangumiApiBase : settings.vndbApiBase,
        proxyMode: settings.proxyMode,
        proxyUrl: settings.proxyUrl,
      };
      const res = apiSource === 'bangumi' ? await searchBangumi(kw, [], cfg) : await searchVndb(kw, cfg);
      setApiResults(res);
      if (res.length === 0) setApiError('没有找到相关结果，换个关键词试试');
      else setApiError('');
    } catch (e) {
      setApiError(`搜索失败：${String(e)}`);
    } finally {
      setApiLoading(false);
    }
  };

  const addFromBangumi = async (item: BangumiItem) => {
    const btypeCat: Category = item.btype === 1 ? 'manga' : item.btype === 4 ? 'galgame' : 'anime';
    const category: Category =
      apiCategory === 'light_novel'
        ? 'light_novel'
        : apiCategory === 'manga'
          ? 'manga'
          : apiCategory === 'anime'
            ? 'anime'
            : apiCategory === 'galgame'
              ? 'galgame'
              : btypeCat;
    const year = item.date ? parseInt(item.date.slice(0, 4), 10) || null : null;
    let cover = item.image ?? '';
    if (cover && settings.downloadCovers && settings.cacheCovers) {
      setAdding(true);
      try {
        cover = await downloadCover(cover, { proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, dataDir: settings.dataDir });
      } catch {
        // 下载失败时保留远程地址
      } finally {
        setAdding(false);
      }
    }
    const totalCount =
      category === 'anime'
        ? (item.totalEpisodes ?? item.eps ?? null)
        : (item.volumes ?? item.eps ?? null);
    setPrefill({
      title: item.nameCn || item.name,
      category,
      year,
      season: category === 'anime' ? seasonFromDate(item.date ?? '') : null,
      synopsis: item.summary,
      cover_path: cover,
      cover_url: item.image ?? '',
      rating: item.score,
      total_count: totalCount && totalCount > 0 ? totalCount : null,
      tags: item.tags.slice(0, 10).join(','),
      links: JSON.stringify([{ label: 'Bangumi', url: `https://bgm.tv/subject/${item.id}` }]),
      source: 'bangumi',
    });
    setQuickOpen(true);
  };

  const addFromVndb = async (item: VndbItem) => {
    const year = item.released ? parseInt(item.released.slice(0, 4), 10) || null : null;
    let cover = item.image ?? '';
    if (cover && settings.downloadCovers && settings.cacheCovers) {
      setAdding(true);
      try {
        cover = await downloadCover(cover, { proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, dataDir: settings.dataDir });
      } catch {
        // 下载失败时保留远程地址
      } finally {
        setAdding(false);
      }
    }
    setPrefill({
      title: item.title,
      category: 'galgame',
      year,
      season: null,
      synopsis: item.description ?? '',
      cover_path: cover,
      cover_url: item.image ?? '',
      rating: item.rating != null ? Math.round((item.rating / 10) * 10) / 10 : null,
      tags: item.tags.slice(0, 8).join(','),
      links: JSON.stringify([{ label: 'VNDB', url: `https://vndb.org/${item.id}` }]),
      source: 'vndb',
    });
    setQuickOpen(true);
  };

  const selectedCount = rows.filter((r) => r.selected).length;
  const isBangumiResults = apiSource === 'bangumi';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>数据导入</h1>
          <p className="page-sub">从 MAL / Bangumi 导出文件，或通过 API 搜索导入</p>
        </div>
      </div>

      <div className="tab-bar glass">
        <button type="button" className={`tab ${tab === 'file' ? 'active' : ''}`} onClick={() => setTab('file')}>
          文件导入
        </button>
        <button type="button" className={`tab ${tab === 'api' ? 'active' : ''}`} onClick={() => setTab('api')}>
          API 搜索
        </button>
      </div>

      {message && <div className="msg">{message}</div>}

      {tab === 'file' && (
        <div className="import-file">
          <div className="glass import-tip">
            <h3>支持的文件格式</h3>
            <p><strong>MAL 导出 XML</strong>：从 MyAnimeList「Settings → Export」下载的 myanimelist.xml，会自动解析番剧与漫画两部分。</p>
            <p><strong>Bangumi CSV</strong>：从 Bangumi 收藏页导出的 CSV 文件（需包含标题/名称列，其余列可选）。</p>
          </div>
          <div className="import-actions">
            <button className="btn primary" onClick={() => void pickFile('mal')} disabled={busy}>
              {busy ? '处理中…' : '选择 MAL XML 文件'}
            </button>
            <button className="btn ghost" onClick={() => void pickFile('bangumi')} disabled={busy}>
              {busy ? '处理中…' : '选择 Bangumi CSV 文件'}
            </button>
          </div>

          {rows.length > 0 && (
            <div className="glass import-preview">
              <div className="import-preview-head">
                <h3>导入预览（{fileKind === 'mal' ? 'MAL XML' : 'Bangumi CSV'}）</h3>
                <label className="check-label">
                  <input type="checkbox" checked={selectedCount === rows.length} onChange={(e) => toggleAll(e.target.checked)} />
                  全选
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>标题</th>
                      <th>类别</th>
                      <th>年份</th>
                      <th>季度</th>
                      <th>状态</th>
                      <th>评分</th>
                      <th>冲突</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.title}-${i}`} className={r.conflict ? 'row-conflict' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={r.selected}
                            onChange={(e) => updateRow(i, { selected: e.target.checked })}
                          />
                        </td>
                        <td className="cell-title" title={r.title}>{r.title}</td>
                        <td>
                          <select
                            className="select select-sm"
                            value={r.category}
                            onChange={(e) => updateRow(i, { category: e.target.value as Category })}
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                            ))}
                          </select>
                        </td>
                        <td>{r.year ?? '—'}</td>
                        <td>
                          {r.category === 'anime' ? (
                            <select
                              className="select select-sm"
                              value={r.season ?? ''}
                              onChange={(e) => updateRow(i, { season: (e.target.value || null) as Season | null })}
                            >
                              <option value="">未知</option>
                              {SEASONS.map((s) => (
                                <option key={s} value={s}>{SEASON_LABELS[s]}</option>
                              ))}
                            </select>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <select
                            className="select select-sm"
                            value={r.status}
                            onChange={(e) => updateRow(i, { status: e.target.value as Status })}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </td>
                        <td>{r.my_rating ?? r.rating ?? '—'}</td>
                        <td>{r.conflict ? <span className="conflict-badge">重复</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-preview-foot">
                <button className="btn ghost" onClick={() => { setRows([]); setFileKind(null); }} disabled={busy}>
                  清空
                </button>
                <button className="btn primary" onClick={() => void doImport()} disabled={busy || selectedCount === 0}>
                  {busy ? '导入中…' : `导入所选（${selectedCount} 条）`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'api' && (
        <div className="import-api">
          <div className="glass import-tip">
            <h3>API 搜索</h3>
            <p><strong>Bangumi</strong>：按关键词搜索全部类别，自动带出简介、封面与链接，单次最多返回 {settings.searchLimit} 条，可再按类别筛选结果。</p>
            <p><strong>VNDB</strong>：按关键词搜索 Galgame，自动带出简介、封面与 VNDB 链接，单次最多返回 {settings.searchLimit} 条。</p>
          </div>
          <div className="api-search-bar glass">
            <div className="filter-group">
              <button type="button" className={`chip ${apiSource === 'bangumi' ? 'active' : ''}`} onClick={() => { setApiSource('bangumi'); setApiCategory('all'); setApiResults(null); setApiError(''); }}>
                Bangumi
              </button>
              <button type="button" className={`chip ${apiSource === 'vndb' ? 'active' : ''}`} onClick={() => { setApiSource('vndb'); setApiCategory('all'); setApiResults(null); setApiError(''); }}>
                VNDB
              </button>
            </div>
            {apiSource === 'bangumi' && (
              <div className="filter-group">
                <span className="filter-label">类别</span>
                {API_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`chip ${apiCategory === c.key ? 'active' : ''}`}
                    onClick={() => setApiCategory(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className="filter-group">
              <input
                className="input"
                placeholder="输入作品名称…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
              />
              <button className="btn primary" onClick={() => void doSearch()} disabled={apiLoading}>
                {apiLoading ? '搜索中…' : '搜索'}
              </button>
            </div>
          </div>

          {apiError && <div className="msg msg-error">{apiError}</div>}

          {apiResults && apiResults.length > 0 && shownApiResults && shownApiResults.length === 0 && (
            <div className="msg">该类别下没有匹配结果，试试切换类别</div>
          )}

          {shownApiResults && shownApiResults.length > 0 && apiSource === 'bangumi' && apiCategory !== 'all' && (
            <div className="api-count">
              共 {apiResults?.length ?? 0} 条结果，当前显示 {shownApiResults.length} 条（{CATEGORY_LABELS[apiCategory]}）
            </div>
          )}

          {shownApiResults && shownApiResults.length > 0 && (
            <div className="api-results glass">
              {shownApiResults.map((item) => {
                const bg = item as BangumiItem;
                const vn = item as VndbItem;
                const title = isBangumiResults ? (bg.nameCn || bg.name) : vn.title;
                const yearRaw = isBangumiResults ? bg.date : vn.released;
                const year = yearRaw ? parseInt(yearRaw.slice(0, 4), 10) || '—' : '—';
                const score = isBangumiResults ? bg.score : vn.rating != null ? Math.round((vn.rating / 10) * 10) / 10 : null;
                const image = isBangumiResults ? bg.image : vn.image;
                return (
                  <div className="api-row" key={isBangumiResults ? `b-${bg.id}` : `v-${vn.id}`}>
                    {image ? <img className="api-thumb" src={image} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} /> : <div className="api-thumb api-thumb-empty">无图</div>}
                    <div className="api-info">
                      <div className="api-title">{title}</div>
                      <div className="api-sub">
                        <span>{year}</span>
                        {score != null && <span className="api-score">★ {score}</span>}
                        {isBangumiResults && <span>{CATEGORY_LABELS[bg.btype === 1 ? 'manga' : bg.btype === 4 ? 'galgame' : 'anime']}</span>}
                      </div>
                    </div>
                    <button
                      className="btn ghost"
                      onClick={() => void (isBangumiResults ? addFromBangumi(bg) : addFromVndb(vn))}
                      disabled={adding}
                    >
                      {adding ? '获取封面中…' : '添加'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <WorkForm
        open={quickOpen}
        prefill={prefill ?? undefined}
        onClose={() => setQuickOpen(false)}
        onSaved={() => {
          setQuickOpen(false);
          setMessage('已添加，可继续搜索并添加其他作品');
        }}
      />
    </div>
  );
}
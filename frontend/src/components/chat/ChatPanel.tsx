'use client'

import Link from 'next/link'
import type { GroupDetail, Me } from '@/hooks/useGroupContext'
import { useGroupMessages } from '@/hooks/useGroupMessages'

import { useEffect, useState, useRef } from 'react'
import { pickName, useNameMode } from '@/lib/nameMode'
import { api, ApiError } from '@/lib/api'
import { useStartPlacePlan } from '@/features/recommendation/useStartPlacePlan'
import MessageList from './MessageList'
import { formatDateBand } from '@/lib/records'
import MessageComposer from './MessageComposer'
import OutgoingPhotos from './OutgoingPhotos'
import PhotoViewerWindow from './PhotoViewerWindow'
import { useOutgoingPhotos } from '@/hooks/useOutgoingPhotos'

import ChatSidebar from './ChatSidebar'
import { useArrivals } from '@/hooks/useArrivals'
import styles from './chat.module.css'
import sel from './chatSelect.module.css'
import { useLocationShare } from '@/hooks/useLocationShare'
import MeetModePanel from './MeetModePanel'
import VoteCreateModal from './VoteCreateModal'
import { takeVotePicks } from '@/lib/votePicks'
import type { PlaceValue } from '@/lib/photos'
import CalIcon from '@/components/CalIcon'

export default function ChatPanel({
  group,
  me,
  focusDate,
}: {
  group: GroupDetail
  me: Me
  /** 지난 기록에서 넘어왔을 때: 이 날짜(YYYY-MM-DD)의 대화로 이동 */
  focusDate?: string
}) {
  const {
    messages,
    loading,
    sending,
    status,
    setStatus,
    send,
    deleteMessage,
    deleteMessages,
    removePhotos,
    loadOlder,
    hasMore,
    loadingOlder,
  } = useGroupMessages(group.id, me.id, focusDate)

  const { start, starting } = useStartPlacePlan(group.id, setStatus)
  const meet = useLocationShare(group.id)
  const arrivalState = useArrivals(group.id)

  // 약속 정보를 처음 불러오는 동안은 "로딩", 2.5초가 지나도 없으면 "약속 없음(잠김)"으로 본다
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500)
    return () => clearTimeout(t)
  }, [])
  const arrivalsLoading = !arrivalState.arrivals && !waited
  const locked = !arrivalsLoading && !arrivalState.arrivals?.meeting

  // 좁은 화면(태블릿·모바일)에서는 Meet Mode 를 오른쪽 칸이 아니라 채팅 위에 둔다
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1050px)')
    const sync = () => setNarrow(mq.matches)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const [voteOpen, setVoteOpen] = useState(false)
  // 약속장소 추천 화면에서 "채팅에서 투표 만들기"로 넘어오면 담은 장소로 투표 창을 연다
  const [votePlaces, setVotePlaces] = useState<PlaceValue[]>([])
  useEffect(() => {
    const places = takeVotePicks(group.id)
    if (places.length > 0) {
      setVotePlaces(places)
      setVoteOpen(true)
    }
  }, [group.id])
  const nameMode = useNameMode()

  const names = new Map(
    group.members.map((m) => [m.user_id, pickName(m, nameMode)]),
  )
  const nameOf = (userId: number) => names.get(userId) ?? '알 수 없음'
  const imageOf = (userId: number) =>
    group.members.find((m) => m.user_id === userId)?.profile_image ?? null

  const isOwner = group.my_role === 'owner'

  // ---- 메시지를 여러 개 골라서 한 번에 삭제 ----
  const MAX_SELECT = 100 // 서버가 한 번에 받는 최대 개수
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // 묶어서 보낸 사진에서 한 장씩 따로 고른 것: 말풍선 번호 -> 첨부 번호들
  const [selectedPhotos, setSelectedPhotos] = useState<
    Map<number, Set<number>>
  >(new Map())
  const [deleting, setDeleting] = useState(false)
  const photoCount = Array.from(selectedPhotos.values()).reduce(
    (n, s) => n + s.size,
    0,
  )
  const pickedTotal = selected.size + photoCount
  const mine = (m: { user_id: number }) => Number(m.user_id) === me.id
  const deletable = messages.filter((m) => mine(m) || isOwner)

  function toggleSelect(id: number) {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_SELECT) next.add(id)
      else setStatus(`한 번에 최대 ${MAX_SELECT}개까지 선택할 수 있어요.`)
      return next
    })
  }

  // 묶음 사진 한 장을 고르거나 푼다. 남은 사진을 전부 골랐으면 말풍선 전체를 고른 것으로 바꾼다.
  function togglePhoto(msgId: number, attId: number, allIds: number[]) {
    if (selected.has(msgId)) {
      // 전체를 골랐던 말풍선에서 한 장을 빼면 → 그 한 장만 빠진 '개별 선택'으로 바뀐다
      setSelected((cur) => {
        const next = new Set(cur)
        next.delete(msgId)
        return next
      })
      setSelectedPhotos((cur) =>
        new Map(cur).set(msgId, new Set(allIds.filter((i) => i !== attId))),
      )
      return
    }
    const set = new Set(selectedPhotos.get(msgId) ?? [])
    if (set.has(attId)) set.delete(attId)
    else set.add(attId)
    if (allIds.length > 0 && set.size >= allIds.length) {
      if (selected.size >= MAX_SELECT) {
        setStatus(`한 번에 최대 ${MAX_SELECT}개까지 선택할 수 있어요.`)
        return
      }
      setSelected((cur) => new Set(cur).add(msgId))
      setSelectedPhotos((cur) => {
        const next = new Map(cur)
        next.delete(msgId)
        return next
      })
      return
    }
    setSelectedPhotos((cur) => {
      const next = new Map(cur)
      if (set.size === 0) next.delete(msgId)
      else next.set(msgId, set)
      return next
    })
  }

  function leaveSelect() {
    setSelectMode(false)
    setSelected(new Set())
    setSelectedPhotos(new Map())
  }

  async function deleteSelected() {
    const ids = Array.from(selected)
    if (!ids.length && photoCount === 0) return
    const hasPhoto =
      photoCount > 0 ||
      messages.some(
        (m) => selected.has(m.id) && (m.text ?? '').startsWith('📷'),
      )
    const parts = [
      ids.length ? `메시지 ${ids.length}개` : '',
      photoCount ? `사진 ${photoCount}장` : '',
    ]
      .filter(Boolean)
      .join('와 ')
    const q =
      `선택한 ${parts}를 삭제할까요?\n모든 팀원에게서 사라져요.` +
      (hasPhoto ? '\n사진은 사진 페이지에서도 함께 지워져요.' : '')
    if (!window.confirm(q)) return
    setDeleting(true)
    let ok = true
    if (ids.length) ok = (await deleteMessages(ids)) !== null
    // 묶음에서 고른 사진은 말풍선마다 한 번씩 지운다 (실패한 것만 선택이 남는다)
    const left = new Map<number, Set<number>>()
    for (const [mid, set] of selectedPhotos) {
      const done = await removePhotos(mid, Array.from(set))
      if (!done) {
        left.set(mid, set)
        ok = false
      }
    }
    setDeleting(false)
    if (ok) leaveSelect()
    else {
      if (ids.length === 0) setSelectedPhotos(left)
      else {
        setSelected(new Set())
        setSelectedPhotos(left)
      }
    }
  }

  useEffect(() => {
    if (!selectMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectMode(false)
        setSelected(new Set())
        setSelectedPhotos(new Map())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode])

  const outgoing = useOutgoingPhotos(group.id, send)

  const MAX_BYTES = { image: 20 * 1024 * 1024, file: 10 * 1024 * 1024 }

  // 사진/문서 한 개를 올린다. 성공하면 첨부 번호와 파일 이름을, 실패하면 null
  async function uploadOne(kind: 'image' | 'file', file: File, progress = '') {
    if (file.size > MAX_BYTES[kind]) {
      setStatus(
        `${MAX_BYTES[kind] / 1024 / 1024}MB 이하 ${kind === 'image' ? '사진' : '파일'}만 보낼 수 있어요.`,
      )
      return null
    }
    const tail = progress ? ` (${progress})` : ''
    setStatus(
      (kind === 'image'
        ? '사진을 올리는 중이에요…'
        : '파일을 올리는 중이에요…') + tail,
    )
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      return await api<{ id: number; filename: string }>(
        `/groups/${group.id}/chat-files`,
        {
          method: 'POST',
          body: form,
        },
      )
    } catch (err) {
      setStatus(
        err instanceof ApiError ? err.message : '파일을 보내지 못했어요.',
      )
      return null
    }
  }

  // 올린 뒤 채팅에 첨부 메시지(마지막 줄 = attach:번호)를 보낸다. 보냈으면 true
  async function uploadAndSend(
    kind: 'image' | 'file',
    file: File,
    progress = '',
  ): Promise<boolean> {
    const att = await uploadOne(kind, file, progress)
    if (!att) return false
    await send(
      kind === 'image'
        ? `📷 사진\nattach:${att.id}`
        : `📎 ${att.filename}\nattach:${att.id}`,
    )
    setStatus('')
    return true
  }

  // 사진을 여러 장 골랐을 때: 묶어서 한 말풍선으로 보내거나, 한 장씩 따로 보낸다.
  // (한 장이 실패해도 나머지는 계속 보낸다)
  const MAX_MULTI = 27
  async function uploadMany(
    kind: 'image' | 'file',
    files: File[],
    opts?: { bundle?: boolean },
  ) {
    const list = files.slice(0, MAX_MULTI)
    const extra =
      files.length > MAX_MULTI
        ? ` 한 번에 최대 ${MAX_MULTI}장까지라 나머지 ${files.length - MAX_MULTI}장은 보내지 않았어요.`
        : ''

    if (kind === 'image') {
      // 카톡처럼: 바로 '보내는 중' 말풍선을 띄우고, 사진을 줄여서 5장씩 동시에 올린다
      const tooBig = list.filter((f) => f.size > MAX_BYTES.image)
      const ok = list.filter((f) => f.size <= MAX_BYTES.image)
      setStatus(
        [
          tooBig.length
            ? `20MB가 넘는 사진 ${tooBig.length}장은 보내지 않았어요.`
            : '',
          extra.trim(),
        ]
          .filter(Boolean)
          .join(' '),
      )
      outgoing.start(ok, Boolean(opts?.bundle))
      return
    }

    let failed = 0
    for (let i = 0; i < list.length; i += 1) {
      const ok = await uploadAndSend(
        kind,
        list[i],
        list.length > 1 ? `${i + 1}/${list.length}` : '',
      )
      if (!ok) failed += 1
    }
    if (list.length > 1) {
      const sent = list.length - failed
      setStatus(
        failed
          ? `${sent}장을 보냈고 ${failed}장은 보내지 못했어요.${extra}`
          : extra.trim(),
      )
    } else if (extra) {
      setStatus(extra.trim())
    }
  }

  const onTool = (tool: string) => {
    if (tool === '장소 선택') {
      void start()
      return
    }

    if (tool === '투표') {
      setVoteOpen(true)
      return
    }

    if (tool === 'MeetMode') {
      if (locked) {
        setStatus('예정된 약속이 없어 Meet Mode는 잠겨 있어요.')
        return
      }
      meet.openAsk()
      return
    }

    setStatus(`${tool} 기능은 다음 단계에서 연결할 예정이에요.`)
  }

  // 모바일: 채팅창 아래 끝을 하단 탭바 바로 위에 딱 맞춘다.
  // 폰마다 탭바 높이가 달라서 CSS 숫자만으로는 밑에 빈 칸이 남을 수 있어, 화면 크기가 바뀔 때만 한 번 재서 맞춘다
  // (스크롤할 때는 아무것도 하지 않으므로 렉이 없다).
  const mainRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const host = el.closest('.content') as HTMLElement | null
    const mq = window.matchMedia('(max-width: 650px)')
    // 하단 탭바: <nav> 자신이나 그 부모 중 화면에 고정(fixed)된 것
    const navEl = document.querySelector('nav')
    let nav: HTMLElement | null = navEl
    while (nav && getComputedStyle(nav).position !== 'fixed')
      nav = nav.parentElement
    const fit = () => {
      if (!mq.matches || !nav) {
        el.style.removeProperty('height')
        host?.style.removeProperty('padding-bottom')
        return
      }
      const viewport = window.visualViewport
      const visibleBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight

      const navTop = nav.getBoundingClientRect().top
      const top = el.getBoundingClientRect().top
      const bottom = Math.min(navTop, visibleBottom)
      const gap = 6

      el.style.setProperty(
        'height',
        `${Math.max(0, Math.floor(bottom - top - gap))}px`,
        'important',
      )
    }
    fit()
    // 폰에서는 주소창이 접히거나 글꼴이 늦게 뜨면서 높이가 한참 뒤에 안정되기도 해서, 처음 몇 번 더 맞춘다
    const timers = [60, 300, 900, 2000].map((ms) => window.setTimeout(fit, ms))
    window.addEventListener('resize', fit)
    window.addEventListener('orientationchange', fit)
    window.visualViewport?.addEventListener('resize', fit)
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    if (nav) ro?.observe(nav)
    ro?.observe(document.body)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener('resize', fit)
      window.removeEventListener('orientationchange', fit)
      window.visualViewport?.removeEventListener('resize', fit)
      ro?.disconnect()
      el.style.removeProperty('height')
      host?.style.removeProperty('padding-bottom')
    }
  }, [])

  const meetPanel = (
    <MeetModePanel
      meet={meet}
      arrivalState={arrivalState}
      loading={arrivalsLoading}
      locked={locked}
      onQuick={(text) => send(text)}
    />
  )

  return (
    <>
      <div className={`page-head ${styles.head}`}>
        <div>
          <p className="eyebrow">그룹 채팅</p>
          <h1 className="page-title">우리의 대화</h1>
          <p className="page-sub">
            약속을 잡고, 사진을 나누고, 다음 이야기를 이어가요.
          </p>
        </div>
        <ChatSidebar members={group.members} groupId={group.id} />
      </div>

      <div className={styles.layout}>
        <div className={styles.chatMain} ref={mainRef}>
          {/* 모바일에서만: 카톡처럼 어떤 그룹 채팅방인지 맨 위에 보여 준다 */}
          <div className={styles.mobileTitle}>
            <strong>{group.name}</strong>
            <span>{group.members.length}명</span>
          </div>
          <div className={styles.banner}>
            <span>함께 정한 약속을 이곳에서 확인해 보세요.</span>
            <Link href={`/groups/${group.id}/meetings`} className="link-arrow">
              약속 보기 →
            </Link>
          </div>

          {focusDate && (
            <div className={styles.banner}>
              <span>
                <CalIcon /> {formatDateBand(focusDate)} 대화로 이동했어요.
              </span>
              <Link href={`/groups/${group.id}/chat`} className="link-arrow">
                최신 대화 보기 →
              </Link>
            </div>
          )}

          {narrow && meetPanel}

          {selectMode && (
            <p className={sel.hint}>
              지울 메시지를 눌러서 고르세요. 묶어 보낸 사진은 사진을 하나씩
              눌러서 그 사진만 고를 수도 있어요. 그만하려면 아래의 “취소하고
              채팅으로 돌아가기”(또는 Esc)를 누르세요. 내가 보낸 메시지만 고를
              수 있어요{isOwner ? ' (방장은 모두)' : ''}. 최대 {MAX_SELECT}
              개까지 선택할 수 있어요.
            </p>
          )}

          <MessageList
            messages={messages}
            loading={loading}
            myUserId={me.id}
            nameOf={nameOf}
            imageOf={imageOf}
            onPost={send}
            focusDate={focusDate}
            onDelete={deleteMessage}
            canDeleteAll={isOwner}
            onLoadOlder={loadOlder}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            selectMode={selectMode}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
            selectedPhotos={selectedPhotos}
            onTogglePhoto={togglePhoto}
          />

          <OutgoingPhotos
            groups={outgoing.groups}
            onRetry={outgoing.retry}
            onDiscard={outgoing.discard}
            onSendDone={outgoing.sendDoneOnly}
          />

          {selectMode ? (
            <section className={sel.dock} aria-label="선택한 메시지 삭제">
              <div className={sel.dockRow}>
                <span className={sel.count}>
                  {selected.size > 0 || photoCount === 0
                    ? `메시지 ${selected.size}개`
                    : ''}
                  {selected.size > 0 && photoCount > 0 ? ' · ' : ''}
                  {photoCount > 0 ? `사진 ${photoCount}장` : ''} 선택됨
                </span>
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() =>
                    setSelected(
                      selected.size >= Math.min(deletable.length, MAX_SELECT)
                        ? new Set()
                        : new Set(
                            deletable.slice(-MAX_SELECT).map((m) => m.id),
                          ),
                    )
                  }
                >
                  {deletable.length > 0 &&
                  selected.size >= Math.min(deletable.length, MAX_SELECT)
                    ? '선택 해제'
                    : '전체 선택'}
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={leaveSelect}
                >
                  취소하고 채팅으로 돌아가기
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={pickedTotal === 0 || deleting}
                  onClick={() => void deleteSelected()}
                >
                  {deleting ? '삭제하는 중…' : `삭제 (${pickedTotal})`}
                </button>
              </div>
              <div className={styles.status} role="status">
                {status}
              </div>
            </section>
          ) : (
            <MessageComposer
              sending={sending}
              planning={starting}
              status={status}
              onSend={send}
              onTool={onTool}
              onFile={uploadAndSend}
              onFiles={uploadMany}
              onSelectMode={() => setSelectMode(true)}
              canSelect={messages.length > 0}
            />
          )}
        </div>

        {!narrow && meetPanel}
      </div>

      <PhotoViewerWindow />

      {voteOpen && (
        <VoteCreateModal
          groupId={group.id}
          initialPlaces={votePlaces}
          onClose={() => {
            setVoteOpen(false)
            setVotePlaces([])
          }}
          // 후보가 저장되면 채팅에 투표 카드를 올린다 (마지막 줄 = 투표 번호). 멤버는 카드에서 바로 투표한다.
          onCreated={async (title, pollId) => {
            await send(`🗳 ${title}\nvote:${pollId}`)
          }}
        />
      )}
    </>
  )
}

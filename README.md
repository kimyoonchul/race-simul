# Race Simul — Track Replay

RaceChrono로 기록한 서킷 주행(GPS)을 브라우저에서 3D로 다시 보는 정적 웹앱입니다.
기본 데이터는 두 세션입니다: 2026-10-28 BMW 드라이빙 센터(15랩), 2025-08-27 인제 스피디움 풀코스(7랩). 화면 왼쪽 위 **BMW / 인제** 버튼으로 바꿉니다.

- 3D 리플레이: 추적 / 온보드 / 중계 / 탑뷰 / 궤도 / 전체 카메라
- 계기판 HUD(크로노그래프풍 눈금 다이얼): 속도, RPM·기어, 시프트 라이트, 랩타이머·스톱워치 초침, 베스트 대비 델타, 섹터, 스로틀·브레이크·디스크 온도 보조 다이얼, G-G, 하중 이동
- 가속·감속 연출: 가속하면 화면 가장자리 줌 블러·속도선·화면 흔들림·배기 불꽃, 감속하면 붉은 가장자리와 제동등 빛 번짐, 만화식 효과음 글자(부웅~, 끼익~), 가감속에 따라 당겨지고 멀어지는 추적 카메라
- 베스트랩 고스트카, 트랙 위 레이싱 라인(제동 빨강 / 가속 초록), 코너별 최저속 비교, 스피드 트랩
- NEW BEST LAP · COOL DOWN · TOP SPEED 배너, 세션 리포트, 엔진 사운드
- 차량 3종 선택(계기판도 각각 다름): Z4 M40i(흰색·GT 윙), M340i Touring(파랑), Stinger 3.3T(그린·빨간 캘리퍼)
- 내 주행 파일 열기: RaceChrono VBO / CSV v3, 위도·경도·속도 열이 있는 CSV — 브라우저 안에서만 처리(서버 전송 없음)
- 등록 서킷(BMW 드라이빙 센터, 인제 스피디움): OpenStreetMap의 실제 서킷 중심선으로 트랙을 그리고 GPS 위치를 그 선형 위로 보정, 피트 레인·부속 도로·건물도 지도 도형으로 배치. 내 파일도 이 두 곳에서 달린 기록이면 자동 적용
- GPS가 끊겨 기록기가 출발선 통과를 놓친 랩(두 바퀴가 한 랩으로 묶임)은 위치로 통과 시각을 되살려 ≈ 표시

데모: https://kimyoonchul.github.io/race-simul/

## 내 파일로 보기

화면 오른쪽 위 **파일** 버튼을 누르거나 VBO/CSV 파일을 화면에 끌어다 놓습니다.
RaceChrono에서는 Export session → `Performance/Circuit Tools (.vbo)` 또는 `CSV v3 (.csv)`로 내보내면 됩니다.
스타트/피니시를 두 번 이상 통과한 기록이어야 랩이 잡힙니다. 차량은 왼쪽 위에서 고릅니다.

## 실행

빌드가 필요 없습니다. 정적 파일을 그대로 호스팅하면 됩니다(GitHub Pages 등).

```bash
node tools/serve.mjs 8126
```

## 데이터 넣기

```bash
node tools/build-data.mjs <session.vbo>
```

`data/session.js`가 다시 만들어집니다. 처리 결과 점검은 `node tools/check-telemetry.mjs`.

VBO가 아닌 기록(RaceChrono CSV 등)이나 두 번째 세션은 브라우저와 같은 파서로 변환합니다.

```bash
node tools/build-session.mjs <기록 파일> data/session-inje.js SESSION_INJE "Inje Speedium"
```

등록 서킷 데이터(`data/venues.js`)는 OpenStreetMap 추출본(`tools/osm/*.json`, 서킷 원점 기준 m 좌표)에서 만듭니다.

```bash
node tools/build-venues.mjs
```

## 실측과 추정

| 구분 | 항목 |
| --- | --- |
| 실측 | 시간, GPS 위치, GPS 속도(폰 내장 GPS 1Hz), 스타트/피니시 통과 기준 랩타임 |
| 추정 | RPM·기어(기어비·타이어 규격으로 역산), 스로틀·브레이크, 종/횡 G, 하중 이동, 디스크 온도(열모델) |

등록 서킷의 트랙 모양은 OpenStreetMap에 올라 있는 서킷 중심선이고(BMW 2.48km, 인제 3.94km), 폭은 대표값 하나로 그립니다. 건물 높이는 지도에 층수·높이가 있으면 그 값, 없으면 면적으로 정한 값입니다.
그 밖의 서킷은 빠른 랩들의 GPS 궤적을 겹쳐 만든 주행선이고 폭은 표시용이며, 서로 다른 구간이 가까운 곳은 겹치지 않게 폭을 줄여 그립니다.
코너 번호(C1…)는 주행선 곡률에서 자동 검출한 것이라 공식 코너 번호와 다릅니다.

## 지도 데이터

등록 서킷의 선형·건물 도형: © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). `tools/osm/*.json`과 `data/venues.js`가 그 파생 데이터입니다.

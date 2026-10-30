<!-- conversation-markdown:v2 -->
<!-- document: {"title":"海平线到底有多远","subtitle":"Conversation Markdown v2 样本","locale":"zh-CN"} -->

<!-- message: {"role":"user","displayName":"周川"} -->
重看第一次看海那段，忽然好奇：站在沙滩上，看到的海平线大概有多远？我顺手画了张示意图。

<!-- image: {"src":"assets/sea-horizon.svg","alt":"站在海边看海平线的示意图","caption":"我画的示意图","width":"medium"} -->
<!-- /message -->

<!-- message: {"role":"assistant","displayName":"Claude","model":"Claude Opus 4.5"} -->
<!-- reasoning: {"title":"思考了 8 秒","durationMs":8000} -->
用户问的是视线到海平线的距离。人眼离海面约 1.7 m，地球半径约 6371 km，用切线近似就够了，再查一下常用的估算公式确认。
<!-- /reasoning -->
<!-- tool-call: {"callId":"search-1","toolName":"web_search","input":{"query":"海平线 距离 估算 公式 眼睛高度"},"status":"success","durationMs":1200} -->
<!-- tool-result: {"summary":"找到 3 个来源","output":{"results":[{"title":"地平线距离近似公式","snippet":"d ≈ 3.57 × √h（d 单位 km，h 单位 m）"}]}} -->

大概 **4.65 公里**，比想象中近。

视线和地球表面相切，用勾股定理：

$$
d = \sqrt{(R + h)^2 - R^2} \approx \sqrt{2Rh}
$$

| 站的位置 | 眼睛高度 | 能看到 |
| --- | ---: | ---: |
| 沙滩上 | 1.7 m | 约 4.65 km |
| 城墙上 | 50 m | 约 25 km |

```python
from math import sqrt

R = 6_371_000  # 地球半径，米
for h in (1.7, 50):
    print(f"{h} m -> {sqrt(2 * R * h) / 1000:.2f} km")
```

所以他们站在沙滩上，看到的其实只是很近的一圈海。
<!-- /message -->

<!-- message: {"role":"user","displayName":"周川"} -->
难怪觉得海特别大又特别近。我把笔记也附上，下次接着聊。

<!-- file: {"src":"assets/sea-character-notes.md","label":"海边的三个人.md"} -->
<!-- /message -->

// 种子6：RegExp 边界模式 —— exec 热循环中 lastIndex 突变 + 全局匹配
// 对应历史漏洞特征：正则引擎 lastIndex / 捕获组边界处理不一致
// （历史多个 JS 引擎 RegExp 越界与状态混淆缺陷）
var re = /(\d+)-(\d+)/g;
var s = "10-20 30-40 50-60";
var sum = 0;
for (var i = 0; i < 30000; i++) {
    re.lastIndex = i % 12;   // 每次从随机偏移恢复匹配，干扰内部状态机
    var m = re.exec(s);
    if (m) sum += (+m[1]) + (+m[2]);
}
console.log(sum);

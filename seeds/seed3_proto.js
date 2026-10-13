// 种子3：原型链/动态属性访问模式 —— Proxy 陷阱 + 属性查找
// 对应历史漏洞特征：动态属性访问引发的语义不一致
function getKey(o) {
    return o.dynamicKey;
}
var base = { dynamicKey: 42 };
for (var i = 0; i < 30000; i++) getKey(base);
var proxy = new Proxy({}, {
    get: function (t, p) {
        if (p === 'dynamicKey') return -1;
        return undefined;
    }
});
for (var j = 0; j < 100; j++) getKey(proxy);
console.log(getKey(base));

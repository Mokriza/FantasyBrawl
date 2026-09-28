using System.Collections;

namespace Brawl.Core;

/// <summary>
/// An immutable map from string keys, kept in insertion order: what a plain object is in
/// the TypeScript core. The order is part of the rules there (Object.values(heroes)
/// decides who is looked at first), so the C# port keeps it too. Replacing a key keeps
/// its place; a new key goes last; removing one closes the gap.
///
/// JavaScript puts integer-like keys ("0", "12") first in numeric order. No map in the
/// game uses such keys (hero ids, ability ids and "q,r" hex keys are never integers),
/// so that rule is not reproduced.
///
/// Every change copies the map. The maps here are small (heroes, cooldowns, terrain),
/// and copying keeps them immutable without a persistent data structure.
/// </summary>
public sealed class OrderedMap<TValue> : IReadOnlyDictionary<string, TValue>
{
    public static readonly OrderedMap<TValue> Empty = new([], new Dictionary<string, int>());

    private readonly KeyValuePair<string, TValue>[] entries;
    private readonly Dictionary<string, int> index;

    private OrderedMap(KeyValuePair<string, TValue>[] entries, Dictionary<string, int> index)
    {
        this.entries = entries;
        this.index = index;
    }

    public static OrderedMap<TValue> From(IEnumerable<KeyValuePair<string, TValue>> pairs)
    {
        var map = Empty;
        foreach (var pair in pairs) map = map.Set(pair.Key, pair.Value);
        return map;
    }

    public int Count => entries.Length;

    public TValue this[string key] =>
        index.TryGetValue(key, out int i) ? entries[i].Value : throw new KeyNotFoundException(key);

    public IEnumerable<string> Keys => entries.Select(e => e.Key);

    public IEnumerable<TValue> Values => entries.Select(e => e.Value);

    public bool ContainsKey(string key) => index.ContainsKey(key);

    public bool TryGetValue(string key, out TValue value)
    {
        if (index.TryGetValue(key, out int i))
        {
            value = entries[i].Value;
            return true;
        }
        value = default!;
        return false;
    }

    /// <summary>The value, or null for a key that is not there (TypeScript's `record[key]`).</summary>
    public TValue? Get(string key) => index.TryGetValue(key, out int i) ? entries[i].Value : default;

    /// <summary>A copy with the key set: in place if it was there, last if it is new.</summary>
    public OrderedMap<TValue> Set(string key, TValue value)
    {
        if (index.TryGetValue(key, out int i))
        {
            var copy = (KeyValuePair<string, TValue>[])entries.Clone();
            copy[i] = new(key, value);
            return new OrderedMap<TValue>(copy, index);
        }
        var grown = new KeyValuePair<string, TValue>[entries.Length + 1];
        Array.Copy(entries, grown, entries.Length);
        grown[entries.Length] = new(key, value);
        var newIndex = new Dictionary<string, int>(index) { [key] = entries.Length };
        return new OrderedMap<TValue>(grown, newIndex);
    }

    /// <summary>A copy without the key; the same map if it was not there.</summary>
    public OrderedMap<TValue> Remove(string key)
    {
        if (!index.ContainsKey(key)) return this;
        return From(entries.Where(e => e.Key != key));
    }

    public IEnumerator<KeyValuePair<string, TValue>> GetEnumerator() => ((IEnumerable<KeyValuePair<string, TValue>>)entries).GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

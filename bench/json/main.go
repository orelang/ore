// JSON: writes an array of objects as text with encoding/json, reads it back
// into structs and sums their fields.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

type Item struct {
	ID     int      `json:"id"`
	Name   string   `json:"name"`
	Score  float64  `json:"score"`
	Active bool     `json:"active"`
	Tags   []string `json:"tags"`
}

func main() {
	n := 300000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	items := make([]Item, 0)
	for i := 0; i < n; i++ {
		items = append(items, Item{ID: i, Name: "item " + strconv.Itoa(i), Score: float64(i%100) * 0.5, Active: i%3 == 0, Tags: []string{"a", "t" + strconv.Itoa(i%10)}})
	}
	text, err := json.Marshal(items)
	if err != nil {
		panic(err)
	}
	var parsed []Item
	if err := json.Unmarshal(text, &parsed); err != nil {
		panic(err)
	}
	ids, score, active, tags := 0, 0.0, 0, 0
	for _, item := range parsed {
		ids += item.ID
		score += item.Score
		if item.Active {
			active++
		}
		tags += len(item.Tags) + len(item.Name)
	}
	fmt.Println(len(text), len(parsed), ids, strconv.FormatFloat(score, 'f', -1, 64), active, tags)
}

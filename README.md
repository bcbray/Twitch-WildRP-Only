# Twitch-WildRP-Only

Install for Chrome: https://chrome.google.com/webstore/detail/twitch-wildrp-only/jnbgafpjnfoocapahlkjihjecoaaaikd

Once installed, go to https://www.twitch.tv/directory/game/Red%20Dead%20Redemption%202 to use.

Everything is automatic, you don't have to do anything.

![Twitch WildRP Only Screenshot 1](https://i.imgur.com/dujQckr.jpeg)

---

This extension is specifically aimed at WildRP viewers on Twitch. It has three primary features:
1. Filtering RDR2 streams to only show WildRP activity.
2. Automatically tagging/customizing WildRP streams based on:
    1. the active character being played.
    2. the faction (if any) that the character belongs to.
3. Searching for specific characters or factions.

### --- FAQ ---

##### "Does this only apply to the RDR2 category on Twitch?"
Yes. This extension will only affect the RDR2 page linked above. Other Twitch pages will not be affected.

##### "How does the tagging work?"
Each channel's title will be compared against their character data to best identify the active character. This includes checking the title for nicknames, partial-names, and faction names. The stream is then tagged with the character name, and the tag is colored based on the character's faction (if one exists). The large majority of WildRP streamers put character indications in their title. However, even if they don't, it will tag the stream with a best-guess (based on who they usually play) surrounded by question-marks, e.g. "? Antonio ?"..

##### "How do you know if it's a WildRP stream?"
Firstly, this extension contains a large list of WildRP streamers (currently 424) who are included by default. This list is updated frequently and fetched during runtime (list changes do not require updating the extension). If they're not in the list (new to WildRP) then the stream title will be checked for terms such as "WildRP", "WRP", "Wild RP" etc. I've never had an issue with it missing a stream. There is also an option to include other RP servers such as SundownRP and NewCenturyRP. However, there is no individual tagging/customizing done for these servers; all of them are colored pale-blue.

##### "What happens if it's a new WildRP streamer, without character data?"
The stream will always be included as long as they are playing on WildRP (and indicate so in their title). If their title contains some indication of a faction, but no info is known about the character, then the stream will be tagged generically based on that faction. E.g. "< Kettleman Gang >". If there is no faction indication, they will just be included without a specific tag.

\---

Tip: Keeping the "Force English only" setting enabled will improve performance when scrolling into the lower-viewcount streams.
